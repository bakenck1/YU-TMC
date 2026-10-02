import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "../app/api/auth/whatsapp-phone/route";
import { GET as listUsers } from "../app/api/users/route";
import { ApplicationError } from "../lib/domain/application-error";
import { getApplicationServices, resetApplicationServicesForTests } from "../lib/server/application";
import { requireCurrentUser } from "../lib/server/security/request-user";
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from "../lib/security/session";
import { resetRateLimitStateForTests } from "../lib/security/rate-limiter";
import type { CurrentAccount } from "../lib/application/services/user-service";
import { UserService } from "../lib/application/services/user-service";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";
import type { ApplicationServices } from "../lib/server/application";

const originalFetch = globalThis.fetch;
const envKeys = ["YU_INVENTORY_TEST_USER_STORE", "WA_API_TOKEN", "WA_SESSION", "SESSION_SECRET"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let calls: Record<string, unknown>[];
beforeEach(() => {
  process.env.YU_INVENTORY_TEST_USER_STORE = "memory";
  process.env.WA_API_TOKEN = "test-only-whatsapp-token";
  process.env.WA_SESSION = "onboarding-test";
  process.env.SESSION_SECRET = "test-onboarding-secret-abcdefghijklmnopqrstuvwxyz0123456789";
  resetApplicationServicesForTests();
  resetRateLimitStateForTests();
  let id = 0;
  const users = new UserService(
    new MemoryUserUnitOfWork(),
    { async hash() { return { salt: "test", hash: new Uint8Array([1]) }; }, async verify() { return false; } },
    { now: () => new Date() },
    { create: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
  );
  (globalThis as typeof globalThis & { __yuInventoryApplication?: ApplicationServices }).__yuInventoryApplication = { users } as ApplicationServices;
  calls = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, registered: true });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetApplicationServicesForTests();
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test("missing employee phones block work APIs, while warehouse staff and existing numbers are exempt", async () => {
  const { employee, warehouse, existing } = await fixture();
  assert.equal(employee.whatsappPhoneRequired, true);
  assert.equal(warehouse.whatsappPhoneRequired, false);
  assert.equal(existing.whatsappPhoneRequired, false);
  await assert.rejects(requireCurrentUser(request(employee, "GET")), (error: unknown) =>
    error instanceof ApplicationError && error.publicCode === "whatsapp_phone_required");
  assert.equal((await requireCurrentUser(request(warehouse, "GET"))).role, "warehouse");
  assert.equal((await requireCurrentUser(request(existing, "GET"))).userId, existing.userId);
});

test("phone completion checks registration, updates only the logged-in user, and renews the session version", async () => {
  const { employee, existing } = await fixture();
  const response = await POST(request(employee, "POST", { phone: "+7 701 111 22 33", userId: existing.userId, role: "admin" }));
  assert.equal(response.status, 200);
  const result = await response.text();
  assert.doesNotMatch(result, /77011112233|701 111/);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(calls, [{ session: "onboarding-test", to: "77011112233" }]);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=strict/i);
  const token = cookie.split(";", 1)[0].split("=", 2)[1];
  const session = verifySessionToken(token)!;
  assert.equal(session.ver, employee.sessionVersion + 1);
  assert.equal(session.role, "employee");
  const current = await getApplicationServices().users.resolveCurrentAccount(employee.email);
  assert.equal(current?.whatsappPhoneRequired, false);
  assert.equal((await getApplicationServices().users.getProfile(employee.userId)).phone, "77011112233");
  assert.equal((await getApplicationServices().users.getProfile(existing.userId)).phone, "87022223344");
  await assert.rejects(requireCurrentUser(request(employee, "GET")), /unauthorized/);
  const authorizedRequest = new Request("https://inventory.example/api/requests", { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } });
  assert.equal((await requireCurrentUser(authorizedRequest)).userId, employee.userId);
});

test("empty and malformed numbers never unlock the account", async () => {
  const { employee } = await fixture();
  for (const phone of ["", "—", "123", "+44 7700 900123"]) {
    assert.equal((await POST(request(employee, "POST", { phone }))).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await getApplicationServices().users.resolveCurrentAccount(employee.email))?.whatsappPhoneRequired, true);
});

test("a number without WhatsApp is rejected and never persisted", async () => {
  const { employee } = await fixture();
  globalThis.fetch = async () => Response.json({ ok: true, registered: false });
  const response = await POST(request(employee, "POST", { phone: "77011112233" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "whatsapp_not_registered");
  assert.equal((await getApplicationServices().users.getProfile(employee.userId)).phone, null);
});

test("a gateway outage or missing configuration keeps the form available without saving an unverified number", async () => {
  const { employee } = await fixture();
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  const response = await POST(request(employee, "POST", { phone: "77011112233" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "whatsapp_check_unavailable");
  delete process.env.WA_API_TOKEN;
  assert.equal((await POST(request(employee, "POST", { phone: "77011112233" }))).status, 503);
  assert.equal((await getApplicationServices().users.getProfile(employee.userId)).phone, null);
});

test("anonymous and cross-origin phone mutations are denied before a gateway call", async () => {
  const { employee } = await fixture();
  const anonymous = new Request("https://inventory.example/api/auth/whatsapp-phone", {
    method: "POST", headers: { origin: "https://inventory.example", "Content-Type": "application/json" }, body: JSON.stringify({ phone: "77011112233" }),
  });
  assert.equal((await POST(anonymous)).status, 401);
  const crossOrigin = request(employee, "POST", { phone: "77011112233" });
  crossOrigin.headers.set("origin", "https://attacker.example");
  assert.equal((await POST(crossOrigin)).status, 403);
  assert.equal(calls.length, 0);
});

test("existing phones and warehouse users cannot replace a phone through onboarding", async () => {
  const { existing, warehouse } = await fixture();
  for (const user of [existing, warehouse]) assert.equal((await POST(request(user, "POST", { phone: "77011112233" }))).status, 409);
  assert.equal(calls.length, 0);
});

test("a revoked session cannot complete onboarding and concurrent submissions cannot overwrite the first number", async () => {
  const { employee } = await fixture();
  const service = getApplicationServices().users;
  await service.revokeSessions(employee.email);
  assert.equal((await POST(request(employee, "POST", { phone: "77011112233" }))).status, 401);
  const actor = (await service.resolveCurrentAccount(employee.email))!;
  const responses = await Promise.all([POST(request(actor, "POST", { phone: "77011112233" })), POST(request(actor, "POST", { phone: "77044445566" }))]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal((await service.resolveCurrentAccount(employee.email))?.whatsappPhoneRequired, false);
});

test("employees with a phone still cannot read the administrative list of phones and IINs", async () => {
  const { existing } = await fixture();
  const response = await listUsers(request(existing, "GET"));
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /87022223344|950101450123/);
});

test("authorized administrators retain the phone and IIN data in the management list", async () => {
  const { existing } = await fixture();
  const service = getApplicationServices().users;
  const admin = (await service.resolveCurrentAccount("admin@example.test"))!;
  const completed = await service.saveOwnWhatsAppPhone(admin, "77000000000");
  const response = await listUsers(request(completed, "GET"));
  assert.equal(response.status, 200);
  const entry = (await response.json()).users.find((user: { id: string }) => user.id === existing.userId);
  assert.equal(entry.iin, "950101450123");
  assert.equal(entry.phone, "87022223344");
});

async function fixture() {
  const service = getApplicationServices().users;
  await service.registerFirstAdmin({ email: "admin@example.test", name: "Admin", password: "Test-password-2026!" });
  const admin = (await service.resolveCurrentAccount("admin@example.test"))!;
  for (const [email, role, phone] of [
    ["employee@example.test", "employee", null],
    ["warehouse@example.test", "warehouse", null],
    ["existing@example.test", "employee", "87022223344"],
  ] as const) {
    await service.createUser({ email, fullName: email, role, phone, active: true, initialPassword: "Test-password-2026!", iin: email.startsWith("existing") ? "950101450123" : undefined }, admin.userId, admin.sessionVersion);
  }
  return {
    employee: (await service.resolveCurrentAccount("employee@example.test"))!,
    warehouse: (await service.resolveCurrentAccount("warehouse@example.test"))!,
    existing: (await service.resolveCurrentAccount("existing@example.test"))!,
  };
}

function request(user: CurrentAccount, method: string, body?: unknown) {
  return new Request("https://inventory.example/api/auth/whatsapp-phone", {
    method,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(user, 3600, user.sessionVersion)}`, origin: "https://inventory.example", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
