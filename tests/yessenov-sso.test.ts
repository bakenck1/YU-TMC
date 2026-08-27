import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import test from "node:test";

import {
  createYessenovAuthorizationRequest,
  createYessenovSsoTransactionToken,
  resetYessenovSigningKeysForTests,
  verifyYessenovIdToken,
  verifyYessenovSsoTransactionToken,
  yessenovSsoConfig,
} from "../lib/security/yessenov-sso";

const CONFIG = {
  clientId: "yu-inventory",
  clientSecret: "test-yessenov-client-secret-with-32-characters",
  redirectUri: "https://inventory.yu.edu.kz/api/auth/yessenov/callback",
};

test("Yessenov SSO requires a complete confidential-client configuration", () => {
  assert.equal(yessenovSsoConfig({}), null);
  assert.equal(
    yessenovSsoConfig({
      YESSENOV_OIDC_CLIENT_ID: CONFIG.clientId,
      YESSENOV_OIDC_CLIENT_SECRET: CONFIG.clientSecret,
      YESSENOV_OIDC_REDIRECT_URI: "http://inventory.yu.edu.kz/api/auth/yessenov/callback",
    }),
    null,
  );
  assert.deepEqual(
    yessenovSsoConfig({
      YESSENOV_OIDC_CLIENT_ID: CONFIG.clientId,
      YESSENOV_OIDC_CLIENT_SECRET: CONFIG.clientSecret,
      YESSENOV_OIDC_REDIRECT_URI: CONFIG.redirectUri,
    }),
    CONFIG,
  );
});

test("Yessenov authorization request uses code flow, nonce, and signed state", () => {
  const request = createYessenovAuthorizationRequest(CONFIG, "/items");
  assert.equal(request.url.href.startsWith("https://id.yu.edu.kz/openid/authorize?"), true);
  assert.equal(request.url.searchParams.get("response_type"), "code");
  assert.equal(request.url.searchParams.get("scope"), "openid profile email");
  assert.equal(request.url.searchParams.has("code_challenge"), false);
  assert.equal(request.url.searchParams.get("state"), request.state);
  assert.equal(request.url.searchParams.get("nonce"), request.nonce);

  process.env.SESSION_SECRET = "test-session-secret-with-more-than-32-characters";
  const token = createYessenovSsoTransactionToken(request, 1_800_000_000);
  assert.deepEqual(verifyYessenovSsoTransactionToken(token, 1_800_000_100), {
    state: request.state,
    nonce: request.nonce,
    returnTo: "/items",
    expiresAt: 1_800_000_600,
  });
  assert.equal(verifyYessenovSsoTransactionToken(token, 1_800_000_601), null);
});

test("Yessenov ID token accepts only signed, verified personnel identities", async () => {
  process.env.NODE_ENV = "test";
  resetYessenovSigningKeysForTests();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  Object.assign(jwk, { kid: "yessenov-test-key", alg: "RS256", use: "sig" });
  const fetcher = async () => Response.json({ keys: [jwk] });
  const now = 1_800_000_000;
  const claims = {
    iss: "https://id.yu.edu.kz/openid",
    aud: CONFIG.clientId,
    sub: "personnel-123",
    nonce: "expected-nonce",
    email: "Employee@YU.EDU.KZ",
    email_verified: true,
    name: "Employee Name",
    is_personnel: true,
    iin: "123456789012",
    iat: now - 10,
    exp: now + 300,
  };
  assert.deepEqual(
    await verifyYessenovIdToken(createIdToken(claims, privateKey), {
      clientId: CONFIG.clientId,
      nonce: "expected-nonce",
      now,
      fetcher,
    }),
    {
      subject: "personnel-123",
      email: "employee@yu.edu.kz",
      name: "Employee Name",
      iin: "123456789012",
    },
  );
  for (const invalidClaims of [
    { ...claims, is_personnel: false },
    { ...claims, email_verified: false },
    { ...claims, email: "employee@example.com" },
    { ...claims, nonce: "wrong" },
  ]) {
    await assert.rejects(
      verifyYessenovIdToken(createIdToken(invalidClaims, privateKey), {
        clientId: CONFIG.clientId,
        nonce: "expected-nonce",
        now,
        fetcher,
      }),
      /claims/,
    );
  }
});

function createIdToken(claims: Record<string, unknown>, privateKey: KeyObject) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "yessenov-test-key", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
