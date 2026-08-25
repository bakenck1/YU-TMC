import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { POST as register } from "../app/api/auth/register/route";
import { ApplicationError } from "../lib/domain/application-error";
import { isAuthorizedBootstrapRequest } from "../lib/security/registration-protection";
import { configuredPublicOrigin } from "../lib/security/public-origin";

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
  const integrity = source.indexOf("requireSameOriginMutation(request)");
  const authorization = source.indexOf("isAuthorizedBootstrapRequest(request)");
  const registrationLimit = source.indexOf("consumeRegistrationLimit(request)");
  const bootstrapState = source.indexOf("isPasswordLoginConfigured()");

  assert.notEqual(integrity, -1);
  assert.notEqual(authorization, -1);
  assert.ok(integrity < authorization);
  assert.ok(authorization < registrationLimit);
  assert.ok(authorization < bootstrapState);
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
  assert.deepEqual(await response.json(), {
    error: "cross_site_request_blocked",
  });
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
    assert.deepEqual(await response.json(), {
      error: "registration_not_authorized",
    });
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
    assert.deepEqual(await response.json(), {
      error: "registration_not_authorized",
    });
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
    assert.deepEqual(await response.json(), {
      error: "registration_not_authorized",
    });
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
    assert.deepEqual(await response.json(), {
      error: "public_origin_not_configured",
    });
  } finally {
    if (previousOrigin === undefined) {
      Reflect.deleteProperty(process.env, "APP_PUBLIC_ORIGIN");
    } else {
      process.env.APP_PUBLIC_ORIGIN = previousOrigin;
    }
  }
});

test("registration UI sends the bootstrap capability without persisting it in form data", () => {
  const source = readFileSync("components/RegisterForm.tsx", "utf8");

  assert.match(source, /Authorization:\s*`Bearer \$\{normalizedBootstrapToken\}`/);
  assert.match(source, /bootstrapToken/);
  const bodyStart = source.indexOf("body: JSON.stringify({");
  const bodyEnd = source.indexOf("}),", bodyStart);
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart);
  assert.doesNotMatch(source.slice(bodyStart, bodyEnd), /bootstrapToken/);
});

test("the environment template documents the public origin required in production", () => {
  const source = readFileSync(".env.example", "utf8");
  assert.match(source, /^APP_PUBLIC_ORIGIN=http:\/\/localhost:3000$/m);
});
