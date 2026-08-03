import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAuthorizedBootstrapRequest } from "../lib/security/registration-protection";

const TOKEN = "bootstrap-secret-that-is-at-least-32-bytes";

function request(authorization?: string) {
  return new Request("https://inventory.example/api/auth/register", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

test("first-admin registration requires the configured bootstrap capability", () => {
  assert.equal(isAuthorizedBootstrapRequest(request(), TOKEN), false);
  assert.equal(
    isAuthorizedBootstrapRequest(request("Bearer wrong-secret"), TOKEN),
    false,
  );
  assert.equal(
    isAuthorizedBootstrapRequest(request(`Bearer ${TOKEN}`), TOKEN),
    true,
  );
  assert.equal(
    isAuthorizedBootstrapRequest(request("Bearer short"), "short"),
    false,
  );
});

test("register route authorizes before revealing bootstrap state", () => {
  const source = readFileSync("app/api/auth/register/route.ts", "utf8");
  const authorization = source.indexOf("isAuthorizedBootstrapRequest(request)");
  const registrationLimit = source.indexOf("consumeRegistrationLimit(request)");
  const bootstrapState = source.indexOf("isPasswordLoginConfigured()");

  assert.notEqual(authorization, -1);
  assert.ok(authorization < registrationLimit);
  assert.ok(authorization < bootstrapState);
});
