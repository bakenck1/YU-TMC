import { GET as getPhoto } from "@/app/api/inventory/items/[id]/photo/route";
import { ApplicationError } from "@/lib/domain/application-error";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limiter";
import { createSessionToken,SESSION_COOKIE_NAME } from "@/lib/security/session";
import { NextRequest } from "next/server";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

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

  it("still rejects revoked sessions and item permission failures before returning bytes", async () => {
    account.mockResolvedValueOnce({ sessionVersion: 2 });
    expect((await getPhoto(request(), { params: Promise.resolve({ id }) })).status).toBe(401);
    expect(photo).not.toHaveBeenCalled();
    photo.mockRejectedValueOnce(new ApplicationError("forbidden", "forbidden"));
    expect((await getPhoto(request(), { params: Promise.resolve({ id }) })).status).toBe(403);
  });

});
