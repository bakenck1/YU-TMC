import "server-only";

import {
  createHash,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  getClientIp,
  InMemoryRateLimiter,
  type RateLimitResult,
} from "./rate-limiter";
import { normalizeEmail } from "./login-protection";

const RESET_CODE_TTL_MS = 15 * 60_000;
const RESET_CODE_ATTEMPTS = 5;

interface ResetCodeRecord {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

type PasswordResetGlobal = typeof globalThis & {
  __yuInventoryPasswordResetCodes?: Map<string, ResetCodeRecord>;
};

const requestByIp = new InMemoryRateLimiter({
  namespace: "password-reset-request-by-ip-v1",
  limit: 10,
  windowMs: 60 * 60_000,
});

const requestByEmail = new InMemoryRateLimiter({
  namespace: "password-reset-request-by-email-v1",
  limit: 3,
  windowMs: 60 * 60_000,
});

const confirmationByIp = new InMemoryRateLimiter({
  namespace: "password-reset-confirm-by-ip-v1",
  limit: 30,
  windowMs: 15 * 60_000,
});

function records() {
  const shared = globalThis as PasswordResetGlobal;
  shared.__yuInventoryPasswordResetCodes ??= new Map();
  return shared.__yuInventoryPasswordResetCodes;
}

function emailKey(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

function hashCode(email: string, code: string) {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

export function consumePasswordResetRequestLimits(
  request: Request,
  email: string,
): RateLimitResult {
  const ipResult = requestByIp.consume(getClientIp(request));
  if (!ipResult.allowed) return ipResult;
  return requestByEmail.consume(emailKey(email));
}

export function consumePasswordResetConfirmationLimit(request: Request) {
  return confirmationByIp.consume(getClientIp(request));
}

export function createPasswordResetCode(email: string) {
  const code = randomInt(100_000, 1_000_000).toString();
  records().set(emailKey(email), {
    codeHash: hashCode(email, code),
    expiresAt: Date.now() + RESET_CODE_TTL_MS,
    attempts: 0,
  });
  return code;
}

export function revokePasswordResetCode(email: string) {
  records().delete(emailKey(email));
}

export function verifyAndConsumePasswordResetCode(email: string, code: string) {
  const key = emailKey(email);
  const record = records().get(key);
  if (!record || record.expiresAt <= Date.now()) {
    records().delete(key);
    return false;
  }

  record.attempts += 1;
  if (record.attempts > RESET_CODE_ATTEMPTS) {
    records().delete(key);
    return false;
  }

  const expected = Buffer.from(record.codeHash);
  const received = Buffer.from(hashCode(email, code));
  const matches =
    expected.length === received.length && timingSafeEqual(expected, received);

  if (matches) records().delete(key);
  return matches;
}
