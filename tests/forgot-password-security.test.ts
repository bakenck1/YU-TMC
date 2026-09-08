import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POST } from "../app/api/auth/forgot-password/route";

import {
  commitPasswordResetCode,
  createPasswordResetCode,
  createPasswordResetUrl,
  revokePasswordResetCode,
  verifyAndConsumePasswordResetCode,
} from "../lib/security/password-reset";

test("password reset links use only the configured public origin", () => {
  assert.equal(
    createPasswordResetUrl(
      "https://inventory.example",
      "employee@example.com",
    ),
    "https://inventory.example/reset-password?email=employee%40example.com",
  );
  assert.throws(
    () => createPasswordResetUrl("https://inventory.example/path", "a@example.com"),
    /invalid_password_reset_public_origin/,
  );
  assert.throws(
    () => createPasswordResetUrl("http://inventory.example", "a@example.com"),
    /invalid_password_reset_public_origin/,
  );
});

test("forgot-password responds before delivery and rejects cross-site submission", () => {
  const source = readFileSync(
    "app/api/auth/forgot-password/route.ts",
    "utf8",
  );

  assert.match(source, /requireSameOriginMutation\(request\)/);
  assert.match(source, /after\(\(\) => \{/);
  assert.doesNotMatch(source, /if \(user\) \{/);
  assert.doesNotMatch(source, /new URL\("\/reset-password", request\.url\)/);
});

test("forgot-password runtime response is correlated by the observer", async () => {
  const response = await POST(new Request("https://inventory.example/api/auth/forgot-password", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  }));

  assert.equal(response.status, 403);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

test("newest delivered reset generation wins out-of-order webhook completion", async () => {
  const email = "reset-race@example.com";
  const older = await createPasswordResetCode(email);
  const newer = await createPasswordResetCode(email);

  await commitPasswordResetCode(email, newer);
  await commitPasswordResetCode(email, older);

  assert.equal(await verifyAndConsumePasswordResetCode(email, older), false);
  assert.equal(await verifyAndConsumePasswordResetCode(email, newer), true);
  assert.equal(await verifyAndConsumePasswordResetCode(email, newer), false);
});

test("failed newer delivery preserves the last delivered reset code", async () => {
  const email = "reset-revoke@example.com";
  const delivered = await createPasswordResetCode(email);
  await commitPasswordResetCode(email, delivered);
  const failed = await createPasswordResetCode(email);

  await revokePasswordResetCode(email, failed);

  assert.equal(await verifyAndConsumePasswordResetCode(email, delivered), true);
});
