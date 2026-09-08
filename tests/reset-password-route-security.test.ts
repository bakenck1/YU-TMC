import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/auth/reset-password/route";
import { resetRateLimitStateForTests } from "../lib/security/rate-limiter";

test("password reset rejects cross-site credential changes", async () => {
  process.env.NODE_ENV = "test";
  resetRateLimitStateForTests();

  const response = await POST(
    new Request("https://inventory.example/api/auth/reset-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({
        email: "employee@yu.edu.kz",
        code: "123456",
        password: "attacker-password",
      }),
    }),
  );

  assert.equal(response.status, 403);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  assert.equal((await response.json() as { error: string }).error, "cross_site_request_blocked");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
});
