import "server-only";

import { createHash } from "node:crypto";
import {
  getClientIp,
  InMemoryRateLimiter,
  clearDurableRateLimit,
  consumeDurableRateLimit,
  type RateLimitResult,
} from "./rate-limiter";

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

const loginIpLimiter = new InMemoryRateLimiter({
  namespace: "login-by-ip-v1",
  limit: 30,
  windowMs: 15 * 60_000,
});

const failedLoginEmailLimiter = new InMemoryRateLimiter({
  namespace: "failed-login-by-email-v1",
  limit: LOGIN_FAILURE_LIMIT,
  windowMs: LOGIN_FAILURE_WINDOW_MS,
});

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function emailRateLimitKey(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export function consumeLoginIpLimit(request: Request) {
  if (process.env.NODE_ENV !== "test") {
    return consumeDurableRateLimit({
      namespace: "login-ip-v2",
      key: getClientIp(request),
      limit: 30,
      windowMs: LOGIN_FAILURE_WINDOW_MS,
    });
  }
  return loginIpLimiter.consume(getClientIp(request));
}

export function consumeLoginEmailLimit(email: string): RateLimitResult | Promise<RateLimitResult> {
  const key = emailRateLimitKey(email);
  if (process.env.NODE_ENV !== "test") {
    return consumeDurableRateLimit({
      namespace: "login-email-v2",
      key,
      limit: LOGIN_FAILURE_LIMIT,
      windowMs: LOGIN_FAILURE_WINDOW_MS,
    });
  }
  return failedLoginEmailLimiter.consume(key);
}

export async function clearFailedLogins(email: string) {
  const key = emailRateLimitKey(email);
  failedLoginEmailLimiter.reset(key);
  if (process.env.NODE_ENV !== "test") {
    await clearDurableRateLimit("login-email-v2", key);
  }
}
