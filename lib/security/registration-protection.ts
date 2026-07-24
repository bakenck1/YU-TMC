import "server-only";

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
