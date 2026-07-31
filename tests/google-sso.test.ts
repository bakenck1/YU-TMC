import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import test from "node:test";
import {
  createGoogleAuthorizationRequest,
  createGoogleSsoTransactionToken,
  googleSsoConfig,
  resetGoogleSigningKeysForTests,
  verifyGoogleIdToken,
  verifyGoogleSsoTransactionToken,
} from "../lib/security/google-sso";

const CONFIG = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: "https://inventory.yu.edu.kz/api/auth/google/callback",
  hostedDomain: "yu.edu.kz",
};

test("Google SSO requires a complete and safe web-server configuration", () => {
  assert.equal(googleSsoConfig({}), null);
  assert.equal(
    googleSsoConfig({
      GOOGLE_CLIENT_ID: CONFIG.clientId,
      GOOGLE_CLIENT_SECRET: CONFIG.clientSecret,
      GOOGLE_REDIRECT_URI:
        "http://inventory.yu.edu.kz/api/auth/google/callback",
    }),
    null,
  );
  assert.equal(
    googleSsoConfig({
      GOOGLE_CLIENT_ID: CONFIG.clientId,
      GOOGLE_CLIENT_SECRET: CONFIG.clientSecret,
      GOOGLE_REDIRECT_URI: CONFIG.redirectUri,
      GOOGLE_WORKSPACE_DOMAIN: "gmail.com",
    }),
    null,
  );
  assert.deepEqual(
    googleSsoConfig({
      GOOGLE_CLIENT_ID: CONFIG.clientId,
      GOOGLE_CLIENT_SECRET: CONFIG.clientSecret,
      GOOGLE_REDIRECT_URI: CONFIG.redirectUri,
      GOOGLE_WORKSPACE_DOMAIN: "YU.EDU.KZ",
    }),
    CONFIG,
  );
});

test("authorization request uses code flow, PKCE, nonce, state, and domain hint", () => {
  const request = createGoogleAuthorizationRequest(CONFIG, "/items?status=active");
  assert.equal(request.url.origin, "https://accounts.google.com");
  assert.equal(request.url.searchParams.get("response_type"), "code");
  assert.equal(request.url.searchParams.get("scope"), "openid email profile");
  assert.equal(request.url.searchParams.get("code_challenge_method"), "S256");
  assert.match(request.url.searchParams.get("code_challenge") ?? "", /^[\w-]{43}$/);
  assert.equal(request.url.searchParams.get("state"), request.state);
  assert.equal(request.url.searchParams.get("nonce"), request.nonce);
  assert.equal(request.url.searchParams.get("hd"), "yu.edu.kz");
  assert.equal(request.returnTo, "/items?status=active");
  assert.equal(
    createGoogleAuthorizationRequest(CONFIG, "https://evil.example").returnTo,
    null,
  );
});

test("OAuth transaction cookie is signed, expiring, and tamper-evident", () => {
  process.env.SESSION_SECRET = "test-session-secret-with-more-than-32-characters";
  const request = createGoogleAuthorizationRequest(CONFIG, "/items");
  const token = createGoogleSsoTransactionToken(request, 1_800_000_000);
  assert.deepEqual(verifyGoogleSsoTransactionToken(token, 1_800_000_100), {
    state: request.state,
    nonce: request.nonce,
    codeVerifier: request.codeVerifier,
    returnTo: "/items",
    expiresAt: 1_800_000_600,
  });
  const [payload, signature] = token.split(".");
  const tamperedSignature = `${signature?.startsWith("a") ? "b" : "a"}${signature?.slice(1)}`;
  assert.equal(
    verifyGoogleSsoTransactionToken(
      `${payload}.${tamperedSignature}`,
      1_800_000_100,
    ),
    null,
  );
  assert.equal(verifyGoogleSsoTransactionToken(token, 1_800_000_601), null);
});

test("ID token verification checks signature and the Workspace domain claim", async () => {
  process.env.NODE_ENV = "test";
  resetGoogleSigningKeysForTests();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  Object.assign(jwk, { kid: "test-key", alg: "RS256", use: "sig" });
  const now = 1_800_000_000;
  const fetcher = async () =>
    Response.json(
      { keys: [jwk] },
      { headers: { "cache-control": "public, max-age=60" } },
    );
  const claims = {
    iss: "https://accounts.google.com",
    aud: CONFIG.clientId,
    sub: "google-subject",
    email: "Employee@YU.EDU.KZ",
    email_verified: true,
    name: "Employee Name",
    hd: "yu.edu.kz",
    nonce: "expected-nonce",
    iat: now - 10,
    exp: now + 300,
  };
  const token = createIdToken(claims, privateKey);

  assert.deepEqual(
    await verifyGoogleIdToken(token, {
      clientId: CONFIG.clientId,
      hostedDomain: CONFIG.hostedDomain,
      nonce: "expected-nonce",
      now,
      fetcher,
    }),
    {
      subject: "google-subject",
      email: "employee@yu.edu.kz",
      name: "Employee Name",
      hostedDomain: "yu.edu.kz",
    },
  );

  await assert.rejects(
    verifyGoogleIdToken(
      createIdToken(
        { ...claims, email: "employee@gmail.com", hd: "gmail.com" },
        privateKey,
      ),
      {
        clientId: CONFIG.clientId,
        hostedDomain: CONFIG.hostedDomain,
        nonce: "expected-nonce",
        now,
        fetcher,
      },
    ),
    /domain is not allowed/,
  );
  await assert.rejects(
    verifyGoogleIdToken(token, {
      clientId: CONFIG.clientId,
      hostedDomain: CONFIG.hostedDomain,
      nonce: "wrong-nonce",
      now,
      fetcher,
    }),
    /claims/,
  );
  await assert.rejects(
    verifyGoogleIdToken(
      createIdToken({ ...claims, azp: "another-client" }, privateKey),
      {
        clientId: CONFIG.clientId,
        hostedDomain: CONFIG.hostedDomain,
        nonce: "expected-nonce",
        now,
        fetcher,
      },
    ),
    /claims/,
  );
  await assert.rejects(
    verifyGoogleIdToken(
      createIdToken(
        { ...claims, aud: [CONFIG.clientId, "another-client"], azp: CONFIG.clientId },
        privateKey,
      ),
      {
        clientId: CONFIG.clientId,
        hostedDomain: CONFIG.hostedDomain,
        nonce: "expected-nonce",
        now,
        fetcher,
      },
    ),
    /claims/,
  );
});

function createIdToken(
  claims: Record<string, unknown>,
  privateKey: KeyObject,
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
