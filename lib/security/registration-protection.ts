import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import {
  getClientIp,
  InMemoryRateLimiter,
  consumeDurableRateLimit,
} from "./rate-limiter";
import { isSecureSecretValue } from "./secret-configuration";

const registrationByIp = new InMemoryRateLimiter({
  namespace: "first-admin-registration-by-ip-v1",
  limit: 5,
  windowMs: 60 * 60_000,
});

export function consumeRegistrationLimit(request: Request) {
  if (process.env.NODE_ENV !== "test") {
    return consumeDurableRateLimit({
      namespace: "first-admin-registration-ip-v2",
      key: getClientIp(request),
      limit: 5,
      windowMs: 60 * 60_000,
    });
  }
  return registrationByIp.consume(getClientIp(request));
}

export function isAuthorizedBootstrapRequest(
  request: Request,
  configuredToken = process.env.AUTH_BOOTSTRAP_TOKEN,
) {
  const expected = configuredToken?.trim() ?? "";
  if (!isSecureSecretValue(expected)) return false;

  const match = /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match?.[1]) return false;

  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(match[1]).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}
