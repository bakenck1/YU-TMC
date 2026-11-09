import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/security/session";
import type { UserRole } from "@/lib/contracts/users";

// Real signed sessions: endpoint tests exercise authentication against PostgreSQL.
export function authenticatedRequest(
  path: string,
  user: { userId: string; role: UserRole; sessionVersion?: number },
  options: { method?: string; body?: unknown; key?: string } = {},
) {
  const token = createSessionToken({
    email: `${user.userId}@example.com`,
    name: "HTTP test user",
    role: user.role,
  }, undefined, user.sessionVersion ?? 1);
  return new Request(`https://inventory.test${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      origin: "https://inventory.test",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.key ? { "idempotency-key": options.key } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}
