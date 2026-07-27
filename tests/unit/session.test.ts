import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  resetSessionStateForTests,
  sessionFromRequest,
  verifySessionToken,
} from "@/lib/security/session";

const SECRET = "yu-inventory-session-unit-secret-2026";
const USER = {
  email: "admin@example.com",
  name: "Admin User",
  role: "admin" as const,
};

function signedPayload(payload: unknown, secret = SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

describe("session tokens", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    resetSessionStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.SESSION_SECRET = "yu-inventory-test-session-secret-2026";
  });

  it("round-trips an authenticated user and enforces the exact expiry boundary", () => {
    const token = createSessionToken(USER, 60);
    expect(verifySessionToken(token)).toMatchObject({
      sub: USER.email,
      name: USER.name,
      role: USER.role,
      exp: 1_767_225_660,
    });

    vi.setSystemTime(new Date("2026-01-01T00:00:59.999Z"));
    expect(verifySessionToken(token)).not.toBeNull();
    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects payload tampering, signature tampering and a wrong secret", () => {
    const token = createSessionToken(USER, 60);
    const [payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.role = "owner";
    const changedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");

    expect(verifySessionToken(`${changedPayload}.${signature}`)).toBeNull();
    expect(verifySessionToken(`${payload}.${signature.slice(0, -1)}x`)).toBeNull();
    process.env.SESSION_SECRET = "a-different-session-secret-with-32-characters";
    expect(verifySessionToken(token)).toBeNull();
  });

  it.each([
    "",
    "only-one-segment",
    "one.two.three",
    ".missing-payload",
    "missing-signature.",
  ])("rejects malformed token %j", (token) => {
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects signed malformed JSON and invalid roles", () => {
    const malformed = Buffer.from("not-json").toString("base64url");
    const malformedSignature = createHmac("sha256", SECRET)
      .update(malformed)
      .digest("base64url");
    expect(verifySessionToken(`${malformed}.${malformedSignature}`)).toBeNull();

    const now = Math.floor(Date.now() / 1_000);
    expect(
      verifySessionToken(
        signedPayload({
          sub: USER.email,
          name: USER.name,
          role: "superadmin",
          iat: now,
          exp: now + 60,
          jti: "fixed-id",
        }),
      ),
    ).toBeNull();
  });

  it("extracts a valid encoded cookie and ignores unrelated cookies", () => {
    const token = createSessionToken(USER, 60);
    const request = new Request("http://localhost", {
      headers: {
        cookie: `theme=dark; yu_inventory_session=${encodeURIComponent(token)}; other=1`,
      },
    });
    expect(sessionFromRequest(request)).toMatchObject({ sub: USER.email });
    expect(sessionFromRequest(new Request("http://localhost"))).toBeNull();
  });
});
