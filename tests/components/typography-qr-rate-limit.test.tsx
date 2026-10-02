import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/inventory/rooms/[id]/qr/route";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/security/session";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limiter";

const { account, findRoom } = vi.hoisted(() => ({ account: vi.fn(), findRoom: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/application", () => ({
  getApplicationServices: () => ({ users: { resolveCurrentAccount: account }, locations: { findRoom } }),
}));

describe("typography print request budget", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "typography-regression-session-secret-at-least-32-characters");
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://inventory.yu.edu.kz");
    resetRateLimitStateForTests();
    account.mockResolvedValue({ userId: "printing-1", role: "typography", sessionVersion: 1, whatsappPhoneRequired: false });
    findRoom.mockImplementation(async (id: string) => ({ id, qrCode: `ROOM-${id}` }));
  });
  afterEach(() => { resetRateLimitStateForTests(); vi.unstubAllEnvs(); });

  it("reproduces why 125 eager API images fail while preserving the individual endpoint limit", async () => {
    const token = createSessionToken({ email: "print@yu.edu.kz", name: "Print", role: "typography" });
    const statuses: number[] = [];
    for (let index = 0; index < 125; index++) {
      const id = `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
      const response = await GET(new Request(`https://inventory.yu.edu.kz/api/inventory/rooms/${id}/qr?format=svg`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }), { params: Promise.resolve({ id }) });
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(120);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });
});
