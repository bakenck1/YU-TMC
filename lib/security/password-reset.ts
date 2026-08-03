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
  generation: number;
}

interface ResetCodeState {
  nextGeneration: number;
  pending: Map<string, ResetCodeRecord>;
  delivered?: ResetCodeRecord;
}

type PasswordResetGlobal = typeof globalThis & {
  __yuInventoryPasswordResetCodes?: Map<string, ResetCodeState>;
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

function stateFor(key: string) {
  const existing = records().get(key);
  if (existing) return existing;
  const state: ResetCodeState = {
    nextGeneration: 1,
    pending: new Map(),
  };
  records().set(key, state);
  return state;
}

function removeEmptyState(key: string, state: ResetCodeState) {
  if (!state.delivered && state.pending.size === 0) records().delete(key);
}

function emailKey(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

function hashCode(email: string, code: string) {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

export function createPasswordResetUrl(publicOrigin: string, email: string) {
  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error("invalid_password_reset_public_origin");
  }
  const localDevelopmentOrigin =
    origin.protocol === "http:" &&
    (origin.hostname === "localhost" ||
      origin.hostname === "127.0.0.1" ||
      origin.hostname === "[::1]");
  if (
    (origin.protocol !== "https:" && !localDevelopmentOrigin) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("invalid_password_reset_public_origin");
  }

  const resetUrl = new URL("/reset-password", origin.origin);
  resetUrl.searchParams.set("email", normalizeEmail(email));
  return resetUrl.toString();
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
  const key = emailKey(email);
  const state = stateFor(key);
  const codeHash = hashCode(email, code);
  state.pending.set(codeHash, {
    codeHash,
    expiresAt: Date.now() + RESET_CODE_TTL_MS,
    attempts: 0,
    generation: state.nextGeneration,
  });
  state.nextGeneration += 1;
  return code;
}

export function commitPasswordResetCode(email: string, code: string) {
  const key = emailKey(email);
  const state = records().get(key);
  if (!state) return;
  const codeHash = hashCode(email, code);
  const record = state.pending.get(codeHash);
  if (!record) return;
  state.pending.delete(codeHash);
  if (!state.delivered || record.generation >= state.delivered.generation) {
    state.delivered = record;
  }
  removeEmptyState(key, state);
}

export function revokePasswordResetCode(email: string, code?: string) {
  const key = emailKey(email);
  if (code === undefined) {
    records().delete(key);
    return;
  }

  const state = records().get(key);
  if (!state) return;
  state.pending.delete(hashCode(email, code));
  removeEmptyState(key, state);
}

export function verifyAndConsumePasswordResetCode(email: string, code: string) {
  const key = emailKey(email);
  const state = records().get(key);
  const record = state?.delivered;
  if (!record || record.expiresAt <= Date.now()) {
    if (state) {
      delete state.delivered;
      removeEmptyState(key, state);
    }
    return false;
  }

  record.attempts += 1;
  if (record.attempts > RESET_CODE_ATTEMPTS) {
    delete state!.delivered;
    removeEmptyState(key, state!);
    return false;
  }

  const expected = Buffer.from(record.codeHash);
  const received = Buffer.from(hashCode(email, code));
  const matches =
    expected.length === received.length && timingSafeEqual(expected, received);

  if (matches) {
    records().delete(key);
  }
  return matches;
}

export function resetPasswordResetStateForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Password-reset state can only be reset in tests");
  }
  records().clear();
}
