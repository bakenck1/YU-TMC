import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPhoto } from "@/app/api/inventory/items/[id]/photo/route";
import { GET as getSession } from "@/app/api/auth/session/route";
import { ApplicationError } from "@/lib/domain/application-error";
import { consumeApiRateLimit, consumePhotoReadRateLimit, consumeSessionReadRateLimit, resetRateLimitStateForTests } from "@/lib/security/rate-limiter";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/security/session";
import { requireCurrentUser } from "@/lib/server/security/request-user";

const { account, photo } = vi.hoisted(() => ({ account: vi.fn(), photo: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/application", () => ({ getApplicationServices: () => ({
  users: { resolveCurrentAccount: account }, items: { getItemPhoto: photo },
}) }));
const id = "11111111-1111-4111-8111-111111111111";
function request(email = "admin@example.test", path = `/api/inventory/items/${id}/photo`) {
  const token = createSessionToken({ email, name: "Admin", role: "admin" });
  return new NextRequest(`https://inventory.yu.edu.kz${path}`, { headers: {
    cookie: `${SESSION_COOKIE_NAME}=${token}`, "x-real-ip": "172.16.0.5",
  } });
}

describe("separate budgets for private photos and session reads", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "photo-session-test-secret-with-at-least-43-characters-123456");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://inventory.yu.edu.kz");
    resetRateLimitStateForTests();
    account.mockResolvedValue({ userId: id, email: "admin@example.test", name: "Admin", role: "admin", sessionVersion: 1, whatsappPhoneRequired: false });
    photo.mockResolvedValue({ bytes: new Uint8Array([1, 2]), mimeType: "image/jpeg" });
  });
  afterEach(() => { resetRateLimitStateForTests(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("serves 250 private thumbnails and the session while retaining the independent API limit", async () => {
    const input = request();
    for (let index = 0; index < 250; index++) {
      const response = await getPhoto(input, { params: Promise.resolve({ id }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const session = await getSession(request("admin@example.test", "/api/auth/session"));
    expect(session.status).toBe(200);
    expect((await session.json()).user.role).toBe("admin");
    for (let index = 0; index < 120; index++) expect((await consumeApiRateLimit(input)).allowed).toBe(true);
    expect((await consumeApiRateLimit(input)).allowed).toBe(false);
    expect((await getPhoto(input, { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await getSession(request("admin@example.test", "/api/auth/session"))).status).toBe(200);
  });

  it("caps each photo account and separates users sharing the same network", async () => {
    const input = request();
    for (let index = 0; index < 300; index++) expect((await consumePhotoReadRateLimit(input)).allowed).toBe(true);
    expect((await getPhoto(input, { params: Promise.resolve({ id }) })).status).toBe(429);
    expect((await consumePhotoReadRateLimit(request("other@example.test"))).allowed).toBe(true);
    expect((await consumeSessionReadRateLimit(input)).allowed).toBe(true);
  });

  it("still rejects revoked sessions and item permission failures before returning bytes", async () => {
    account.mockResolvedValueOnce({ sessionVersion: 2 });
    expect((await getPhoto(request(), { params: Promise.resolve({ id }) })).status).toBe(401);
    expect(photo).not.toHaveBeenCalled();
    photo.mockRejectedValueOnce(new ApplicationError("forbidden", "forbidden"));
    expect((await getPhoto(request(), { params: Promise.resolve({ id }) })).status).toBe(403);
  });

  it("does not grant the photo read budget to mutations", async () => {
    const input = request();
    for (let index = 0; index < 120; index++) await consumeApiRateLimit(input);
    const headers = new Headers(input.headers);
    headers.set("origin", "https://inventory.yu.edu.kz");
    const mutation = new Request(input.url, { method: "POST", headers });
    await expect(requireCurrentUser(mutation, { photoRead: true })).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("keeps unsigned requests bounded by IP", async () => {
    const input = new Request("https://inventory.yu.edu.kz/api/auth/session", { headers: { cookie: `${SESSION_COOKIE_NAME}=invalid`, "x-real-ip": "172.16.0.5" } });
    for (let index = 0; index < 20; index++) expect((await consumeSessionReadRateLimit(input)).allowed).toBe(true);
    expect((await consumeSessionReadRateLimit(input)).allowed).toBe(false);
  });
});
