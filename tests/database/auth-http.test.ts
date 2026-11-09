import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as session } from "@/app/api/auth/session/route";
import { GET as items } from "@/app/api/inventory/items/route";
import { GET as users } from "@/app/api/users/route";
import { LOGIN_FAILURE_LIMIT } from "@/lib/security/login-protection";
import { consumeApiRateLimit,consumePhotoReadRateLimit,consumeSessionReadRateLimit } from "@/lib/security/rate-limiter";
import { createSessionToken,SESSION_COOKIE_NAME } from "@/lib/security/session";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { requireCurrentUser } from "@/lib/server/security/request-user";
import { NextRequest } from "next/server";
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { database,setupTmcTransferDatabase,teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: () => undefined }));
const origin = "https://inventory.test";
const capability = "integration-bootstrap-capability-at-least-43-characters";
const email = "http-admin@example.test";
const password = "HTTP-integration-password-2026!";
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
describe("authentication endpoints with production durable limits and test PostgreSQL", () => {
  let adminId: string;
  beforeAll(async () => {
    resetApplicationServicesForTests();
    // The same explicit disposable-database exception used by production E2E.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_DIST_DIR", ".next-e2e");
    vi.stubEnv("YU_INVENTORY_E2E_DATABASE_TARGET", "test");
    vi.stubEnv("DATABASE_TARGET", "test");
    vi.stubEnv("APP_PUBLIC_ORIGIN", origin);
    vi.stubEnv("AUTH_BOOTSTRAP_TOKEN", capability);
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
    await setupTmcTransferDatabase();
    const registered = await register(post("/api/auth/register", { firstName: "HTTP", lastName: "Administrator", email, password }, { authorization: `Bearer ${capability}` }));
    expect(registered.status, await registered.clone().text()).toBe(201);
    adminId = (await database.query("select id from yu_inventory.users where email=$1", [email])).rows[0].id;
  });
  afterAll(async () => { vi.unstubAllEnvs(); resetApplicationServicesForTests(); await teardownTmcTransferDatabase(); });

  it.each([["login", login], ["register", register], ["forgot-password", forgotPassword], ["logout", logout]] as const)("blocks cross-origin %s before changing authentication state", async (name, endpoint) => {
    const request = post(`/api/auth/${name}`, { email, password }, { origin: "https://attacker.invalid", authorization: `Bearer ${capability}` });
    const response = await endpoint(request);
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await database.query("select version from yu_inventory.users where id=$1", [adminId])).rows).toEqual([{ version: 1 }]);
  });

  it("does not reveal that registration is closed to a caller lacking its capability", async () => {
    const response = await register(post("/api/auth/register", { email: "other@example.test", password }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "registration_not_authorized" });
    expect((await database.query("select count(*)::int n from yu_inventory.users")).rows).toEqual([{ n: 1 }]);
  });

  it("bounds real login requests and rejects unsupported content without issuing a session", async () => {
    const media = await login(new Request(origin + "/api/auth/login", { method: "POST", headers: { origin, "content-type": "text/plain" }, body: "credentials" }));
    expect(media.status).toBe(415);
    const large = await login(post("/api/auth/login", { email, password: "x".repeat(20_000) }));
    expect(large.status).toBe(413);
    expect(media.headers.get("set-cookie")).toBeNull();
    expect(large.headers.get("set-cookie")).toBeNull();
  });

  it("issues a secure session for real credentials and logout revokes it in PostgreSQL", async () => {
    const response = await login(post("/api/auth/login", { email, password }));
    expect(response.status, await response.clone().text()).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/SameSite=(?:lax|strict)/i);
    const pair = cookie.split(";")[0];
    expect(pair.startsWith(SESSION_COOKIE_NAME + "=")).toBe(true);
    const before = await session(new NextRequest(origin + "/api/auth/session", { headers: { cookie: pair } }));
    expect(before.status).toBe(200);
    expect((await before.json()).user.email).toBe(email);
    const loggedOut = await logout(post("/api/auth/logout", {}, { cookie: pair }));
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    const revoked = await users(new Request(origin + "/api/users", { headers: { cookie: pair } }));
    expect(revoked.status).toBe(401);
  });

  it("persists email throttling and rejects even correct credentials once that email budget is exhausted", async () => {
    const request = () => post("/api/auth/login", { email, password: "incorrect" }, { "x-real-ip": "192.0.2.40" });
    for (let n = 0; n < LOGIN_FAILURE_LIMIT; n++) expect((await login(request())).status).toBe(401);
    const response = await login(post("/api/auth/login", { email, password }, { "x-real-ip": "192.0.2.41" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await database.query("select count(*)::int n from yu_inventory.security_rate_limits")).rows[0].n).toBeGreaterThan(0);
  });

  it("uses a durable API budget across fresh requests and retains a separate budget for another IP", async () => {
    const version = (await database.query("select version from yu_inventory.users where id=$1", [adminId])).rows[0].version as number;
    const make = (ip: string) => new Request(origin + "/api/inventory/items", { headers: {
      cookie: `${SESSION_COOKIE_NAME}=${createSessionToken({ email, name: "HTTP administrator", role: "admin" }, undefined, version)}`,
      "x-real-ip": ip,
    } });
    const first = await consumeApiRateLimit(make("192.0.2.50"));
    for (let n = 0; n < first.remaining; n++) expect((await items(make("192.0.2.50"))).status).toBe(200);
    const limited = await items(make("192.0.2.50"));
    expect(limited.status).toBe(429);
    expect((await items(make("192.0.2.51"))).status).toBe(200);
  });

  it("separates durable photo, session and mutation budgets for accounts sharing an IP", async () => {
    const version = (await database.query("select version from yu_inventory.users where id=$1", [adminId])).rows[0].version as number;
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken({ email, name: "HTTP administrator", role: "admin" }, undefined, version)}`;
    const request = new Request(origin + "/api/inventory/items/photo", { headers: { cookie, "x-real-ip": "192.0.2.60" } });
    const budget = await consumePhotoReadRateLimit(request);
    for (let n = 0; n < budget.remaining; n++) expect((await consumePhotoReadRateLimit(request)).allowed).toBe(true);
    expect((await consumePhotoReadRateLimit(request)).allowed).toBe(false);
    expect((await consumeSessionReadRateLimit(request)).allowed).toBe(true);
    const otherCookie = `${SESSION_COOKIE_NAME}=${createSessionToken({ email: "another@example.test", name: "Another", role: "employee" })}`;
    const other = new Request(request.url, { headers: { cookie: otherCookie, "x-real-ip": "192.0.2.60" } });
    expect((await consumePhotoReadRateLimit(other)).allowed).toBe(true);
    const api = await consumeApiRateLimit(request);
    for (let n = 0; n < api.remaining; n++) await consumeApiRateLimit(request);
    const mutation = new Request(request.url, { method: "POST", headers: { cookie, origin, "x-real-ip": "192.0.2.60" } });
    await expect(requireCurrentUser(mutation, { photoRead: true })).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("bounds unsigned session reads by IP independently of signed account budgets", async () => {
    const request = new Request(origin + "/api/auth/session", { headers: { "x-real-ip": "192.0.2.61", cookie: `${SESSION_COOKIE_NAME}=invalid` } });
    const budget = await consumeSessionReadRateLimit(request);
    for (let n = 0; n < budget.remaining; n++) expect((await consumeSessionReadRateLimit(request)).allowed).toBe(true);
    expect((await consumeSessionReadRateLimit(request)).allowed).toBe(false);
    const next = new Request(request.url, { headers: { "x-real-ip": "192.0.2.62" } });
    expect((await consumeSessionReadRateLimit(next)).allowed).toBe(true);
  });
});
