import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import {
  getClientIp,
  InMemoryRateLimiter,
} from "./rate-limiter";

const registrationByIp = new InMemoryRateLimiter({
  namespace: "first-admin-registration-by-ip-v1",
  limit: 5,
  windowMs: 60 * 60_000,
});

export function consumeRegistrationLimit(request: Request) {
  return registrationByIp.consume(getClientIp(request));
}

export function isAuthorizedBootstrapRequest(
  request: Request,
  configuredToken = process.env.AUTH_BOOTSTRAP_TOKEN,
) {
  const expected = configuredToken?.trim() ?? "";
  if (Buffer.byteLength(expected, "utf8") < 32) return false;

  const match = /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match?.[1]) return false;

  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(match[1]).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}
