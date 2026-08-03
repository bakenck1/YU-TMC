import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/auth/logout/route";
import { resetRateLimitStateForTests } from "../lib/security/rate-limiter";

test("logout rejects cross-site cookie-authenticated requests", async () => {
  process.env.NODE_ENV = "test";
  resetRateLimitStateForTests();

  const response = await POST(
    new Request("https://inventory.example/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: "yu_inventory_session=stolen-session",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("logout clears the host-only root session cookie", async () => {
  process.env.NODE_ENV = "test";
  resetRateLimitStateForTests();

  const response = await POST(
    new Request("https://inventory.example/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://inventory.example",
        "sec-fetch-site": "same-origin",
      },
    }),
  );

  const cookie = response.headers.get("set-cookie") ?? "";
  assert.equal(response.status, 200);
  assert.match(cookie, /^yu_inventory_session=;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=strict/i);
  assert.doesNotMatch(cookie, /Domain=/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("API rate exhaustion cannot prevent local session termination", async () => {
  process.env.NODE_ENV = "test";
  resetRateLimitStateForTests();
  const request = () =>
    new Request("https://inventory.example/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://inventory.example",
        "sec-fetch-site": "same-origin",
        "x-real-ip": "192.0.2.10",
      },
    });

  let response!: Response;
  for (let index = 0; index < 121; index += 1) {
    response = await POST(request());
  }

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
