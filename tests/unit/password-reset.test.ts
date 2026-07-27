import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumePasswordResetConfirmationLimit,
  consumePasswordResetRequestLimits,
  commitPasswordResetCode,
  createPasswordResetCode,
  resetPasswordResetStateForTests,
  revokePasswordResetCode,
  verifyAndConsumePasswordResetCode,
} from "@/lib/security/password-reset";
import { resetRateLimitStateForTests } from "@/lib/security/rate-limiter";

function request(ip: string) {
  return new Request("http://localhost/api/auth/reset-password", {
    headers: { "x-forwarded-for": ip },
  });
}

function createDeliveredCode(email: string) {
  const code = createPasswordResetCode(email);
  commitPasswordResetCode(email, code);
  return code;
}

describe("password-reset security state", () => {
  beforeEach(() => {
    resetPasswordResetStateForTests();
    resetRateLimitStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a six-digit one-time code bound to normalized email", () => {
    const code = createDeliveredCode("  Admin@Example.COM ");
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyAndConsumePasswordResetCode("admin@example.com", code)).toBe(true);
    expect(verifyAndConsumePasswordResetCode("admin@example.com", code)).toBe(false);
  });

  it("revokes a code explicitly and lets a newer request supersede the old one", () => {
    const revoked = createDeliveredCode("admin@example.com");
    revokePasswordResetCode("admin@example.com");
    expect(verifyAndConsumePasswordResetCode("admin@example.com", revoked)).toBe(false);

    const oldCode = createDeliveredCode("admin@example.com");
    const currentCode = createDeliveredCode("admin@example.com");
    expect(verifyAndConsumePasswordResetCode("admin@example.com", oldCode)).toBe(false);
    expect(verifyAndConsumePasswordResetCode("admin@example.com", currentCode)).toBe(true);
  });

  it("does not revoke a newer code when an older delivery fails", () => {
    const oldCode = createPasswordResetCode("admin@example.com");
    const currentCode = createPasswordResetCode("admin@example.com");
    revokePasswordResetCode("admin@example.com", oldCode);
    commitPasswordResetCode("admin@example.com", currentCode);
    expect(verifyAndConsumePasswordResetCode("admin@example.com", currentCode)).toBe(true);
  });

  it("restores the last delivered code when a newer delivery fails", () => {
    const deliveredCode = createPasswordResetCode("admin@example.com");
    commitPasswordResetCode("admin@example.com", deliveredCode);
    const failedCode = createPasswordResetCode("admin@example.com");
    revokePasswordResetCode("admin@example.com", failedCode);
    expect(
      verifyAndConsumePasswordResetCode("admin@example.com", deliveredCode),
    ).toBe(true);
  });

  it("never restores an undelivered code after overlapping failures", () => {
    const deliveredCode = createPasswordResetCode("admin@example.com");
    commitPasswordResetCode("admin@example.com", deliveredCode);
    const failedMiddle = createPasswordResetCode("admin@example.com");
    const failedNewest = createPasswordResetCode("admin@example.com");
    revokePasswordResetCode("admin@example.com", failedMiddle);
    revokePasswordResetCode("admin@example.com", failedNewest);
    expect(
      verifyAndConsumePasswordResetCode("admin@example.com", deliveredCode),
    ).toBe(true);
  });

  it("invalidates every pending request after a successful reset", () => {
    const deliveredCode = createDeliveredCode("admin@example.com");
    const pendingCode = createPasswordResetCode("admin@example.com");
    expect(
      verifyAndConsumePasswordResetCode("admin@example.com", deliveredCode),
    ).toBe(true);
    commitPasswordResetCode("admin@example.com", pendingCode);
    expect(
      verifyAndConsumePasswordResetCode("admin@example.com", pendingCode),
    ).toBe(false);
  });

  it("expires at the exact fifteen-minute boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const almostExpired = createDeliveredCode("first@example.com");
    vi.advanceTimersByTime(15 * 60_000 - 1);
    expect(verifyAndConsumePasswordResetCode("first@example.com", almostExpired)).toBe(true);

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const expired = createDeliveredCode("second@example.com");
    vi.advanceTimersByTime(15 * 60_000);
    expect(verifyAndConsumePasswordResetCode("second@example.com", expired)).toBe(false);
  });

  it("accepts the valid code on the fifth total attempt", () => {
    const code = createDeliveredCode("admin@example.com");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(verifyAndConsumePasswordResetCode("admin@example.com", "000000")).toBe(false);
    }
    expect(verifyAndConsumePasswordResetCode("admin@example.com", code)).toBe(true);
  });

  it("destroys a code after five wrong guesses", () => {
    const code = createDeliveredCode("admin@example.com");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(verifyAndConsumePasswordResetCode("admin@example.com", "000000")).toBe(false);
    }
    expect(verifyAndConsumePasswordResetCode("admin@example.com", code)).toBe(false);
  });

  it("allows three reset requests per normalized email and keeps other emails independent", () => {
    const variants = ["Admin@example.com", " admin@EXAMPLE.com ", "ADMIN@example.com"];
    variants.forEach((email, index) => {
      expect(
        consumePasswordResetRequestLimits(request(`198.51.100.${index + 1}`), email).allowed,
      ).toBe(true);
    });
    expect(
      consumePasswordResetRequestLimits(request("198.51.100.20"), "admin@example.com").allowed,
    ).toBe(false);
    expect(
      consumePasswordResetRequestLimits(request("198.51.100.21"), "other@example.com").allowed,
    ).toBe(true);
  });

  it("allows ten reset requests per IP and blocks the eleventh", () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        consumePasswordResetRequestLimits(
          request("203.0.113.10"),
          `person-${attempt}@example.com`,
        ).allowed,
      ).toBe(true);
    }
    expect(
      consumePasswordResetRequestLimits(
        request("203.0.113.10"),
        "last@example.com",
      ).allowed,
    ).toBe(false);
  });

  it("allows thirty confirmation attempts per IP and blocks the thirty-first", () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(
        consumePasswordResetConfirmationLimit(request("192.0.2.44")).allowed,
      ).toBe(true);
    }
    expect(
      consumePasswordResetConfirmationLimit(request("192.0.2.44")).allowed,
    ).toBe(false);
    expect(
      consumePasswordResetConfirmationLimit(request("192.0.2.45")).allowed,
    ).toBe(true);
  });
});
