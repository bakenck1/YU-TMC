import assert from "node:assert/strict";
import test from "node:test";

import { POST as register } from "../app/api/auth/register/route";
import { ApplicationError } from "../lib/domain/application-error";
import { configuredPublicOrigin } from "../lib/security/public-origin";
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

test("register route rejects cross-site mutations before bootstrap checks", async () => {
  const response = await register(
    new Request("https://inventory.example/api/auth/register", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    }),
  );

  assert.equal(response.status, 403);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  assert.equal((await response.json() as { error: string }).error, "cross_site_request_blocked");
});

test("register route returns a neutral authorization error without a bootstrap token", async () => {
  const previousToken = process.env.AUTH_BOOTSTRAP_TOKEN;
  Reflect.deleteProperty(process.env, "AUTH_BOOTSTRAP_TOKEN");
  try {
    const response = await register(
      new Request("https://inventory.example/api/auth/register", {
        method: "POST",
        headers: { origin: "https://inventory.example" },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "registration_not_authorized");
  } finally {
    if (previousToken === undefined) {
      Reflect.deleteProperty(process.env, "AUTH_BOOTSTRAP_TOKEN");
    } else {
      process.env.AUTH_BOOTSTRAP_TOKEN = previousToken;
    }
  }
});

test("register route rejects a missing bearer token when bootstrap is configured", async () => {
  const previousToken = process.env.AUTH_BOOTSTRAP_TOKEN;
  process.env.AUTH_BOOTSTRAP_TOKEN = TOKEN;
  try {
    const response = await register(
      new Request("https://inventory.example/api/auth/register", {
        method: "POST",
        headers: { origin: "https://inventory.example" },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "registration_not_authorized");
  } finally {
    if (previousToken === undefined) {
      Reflect.deleteProperty(process.env, "AUTH_BOOTSTRAP_TOKEN");
    } else {
      process.env.AUTH_BOOTSTRAP_TOKEN = previousToken;
    }
  }
});

test("register route rejects a wrong bearer token before reading registration state", async () => {
  const previousToken = process.env.AUTH_BOOTSTRAP_TOKEN;
  process.env.AUTH_BOOTSTRAP_TOKEN = TOKEN;
  try {
    const response = await register(
      new Request("https://inventory.example/api/auth/register", {
        method: "POST",
        headers: {
          origin: "https://inventory.example",
          authorization: "Bearer wrong-bootstrap-token",
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "registration_not_authorized");
  } finally {
    if (previousToken === undefined) {
      Reflect.deleteProperty(process.env, "AUTH_BOOTSTRAP_TOKEN");
    } else {
      process.env.AUTH_BOOTSTRAP_TOKEN = previousToken;
    }
  }
});

test("production origin configuration fails closed when missing or not HTTPS", () => {
  assert.throws(
    () => configuredPublicOrigin({ NODE_ENV: "production" }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.publicCode === "public_origin_not_configured",
  );
  assert.throws(
    () =>
      configuredPublicOrigin({
        NODE_ENV: "production",
        APP_PUBLIC_ORIGIN: "http://inventory.example",
      }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.publicCode === "public_origin_not_configured",
  );
  assert.equal(
    configuredPublicOrigin({
      NODE_ENV: "production",
      APP_PUBLIC_ORIGIN: "http://localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("register route maps an invalid public origin before registration state", async () => {
  const previousOrigin = process.env.APP_PUBLIC_ORIGIN;
  process.env.APP_PUBLIC_ORIGIN = "http://inventory.example";
  try {
    const response = await register(
      new Request("https://inventory.example/api/auth/register", {
        method: "POST",
        headers: { origin: "https://inventory.example" },
      }),
    );

    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error: string }).error, "public_origin_not_configured");
  } finally {
    if (previousOrigin === undefined) {
      Reflect.deleteProperty(process.env, "APP_PUBLIC_ORIGIN");
    } else {
      process.env.APP_PUBLIC_ORIGIN = previousOrigin;
    }
  }
});
