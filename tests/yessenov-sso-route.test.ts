import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as yessenovCallback } from "../app/api/auth/yessenov/callback/route";
import { GET as startYessenovSso } from "../app/api/auth/yessenov/route";
import { resetRateLimitStateForTests } from "../lib/security/rate-limiter";
import { YESSENOV_SSO_TRANSACTION_COOKIE } from "../lib/security/yessenov-sso";

test("unconfigured Yessenov SSO uses a host-independent login redirect", async () => {
  process.env.NODE_ENV = "test";
  delete process.env.YESSENOV_OIDC_CLIENT_ID;
  delete process.env.YESSENOV_OIDC_CLIENT_SECRET;
  delete process.env.YESSENOV_OIDC_REDIRECT_URI;
  resetRateLimitStateForTests();

  const response = await startYessenovSso(
    new Request("https://attacker-controlled.example/api/auth/yessenov"),
  );
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login?error=yessenov_not_configured");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unconfigured Yessenov callback clears state without trusting Host", async () => {
  process.env.NODE_ENV = "test";
  delete process.env.YESSENOV_OIDC_CLIENT_ID;
  delete process.env.YESSENOV_OIDC_CLIENT_SECRET;
  delete process.env.YESSENOV_OIDC_REDIRECT_URI;
  resetRateLimitStateForTests();

  const response = await yessenovCallback(
    new NextRequest(
      "https://attacker-controlled.example/api/auth/yessenov/callback",
    ),
  );
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login?error=yessenov_not_configured");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(
    response.headers.get("set-cookie") ?? "",
    new RegExp(`${YESSENOV_SSO_TRANSACTION_COOKIE}=;`),
  );
});
