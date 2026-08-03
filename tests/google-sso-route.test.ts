import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as googleCallback } from "../app/api/auth/google/callback/route";
import { GET as startGoogleSso } from "../app/api/auth/google/route";
import {
  GOOGLE_SSO_TRANSACTION_COOKIE,
} from "../lib/security/google-sso";
import { resetRateLimitStateForTests } from "../lib/security/rate-limiter";

test("unconfigured Google SSO uses a host-independent login redirect", async () => {
  process.env.NODE_ENV = "test";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  resetRateLimitStateForTests();

  const response = await startGoogleSso(
    new Request("https://attacker-controlled.example/api/auth/google"),
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login?error=google_not_configured");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unconfigured Google callback uses a host-independent login redirect", async () => {
  process.env.NODE_ENV = "test";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  resetRateLimitStateForTests();

  const response = await googleCallback(
    new NextRequest(
      "https://attacker-controlled.example/api/auth/google/callback",
    ),
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login?error=google_not_configured");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(
    response.headers.get("set-cookie") ?? "",
    new RegExp(`${GOOGLE_SSO_TRANSACTION_COOKIE}=;`),
  );
});
