import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getClientIp } from "../lib/security/rate-limiter";
import type { UserRepositories } from "../lib/application/ports/user-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { UserService } from "../lib/application/services/user-service";
import { ApplicationError } from "../lib/domain/application-error";
import {
  assertLoginJsonRequest,
  MAX_LOGIN_JSON_BYTES,
  readLoginJsonRequest,
} from "../lib/security/login-request";

test("login rejects cross-site credential submission before authentication", () => {
  const source = readFileSync("app/api/auth/login/route.ts", "utf8");
  const integrityCheck = source.indexOf("requireSameOriginMutation(request)");
  const authentication = source.indexOf("users.authenticate(");

  assert.ok(integrityCheck >= 0, "login route must enforce same-origin mutation");
  assert.ok(
    integrityCheck < authentication,
    "origin validation must run before credential authentication",
  );
  assert.match(source, /applicationErrorResponse\(error, rateLimitHeaders\(apiLimit\)\)/);
});

test("login validates and bounds JSON before parsing credentials", () => {
  const source = readFileSync("app/api/auth/login/route.ts", "utf8");
  const guard = source.indexOf("assertLoginJsonRequest(request)");
  const parse = source.indexOf("readLoginJsonRequest(request)");

  assert.ok(guard >= 0 && guard < parse);
  assert.doesNotMatch(source, /request\.json\(\)/);
});

test("email failure throttling cannot lock out a valid password", () => {
  const source = readFileSync("app/api/auth/login/route.ts", "utf8");
  const authentication = source.indexOf("users.authenticate(");
  const emailLimit = source.indexOf("checkFailedLoginLimit(email)");

  assert.ok(authentication >= 0 && authentication < emailLimit);
});

test("client-supplied forwarding headers are ignored without trusted proxy configuration", () => {
  const previous = process.env.TRUSTED_CLIENT_IP_HEADER;
  Reflect.deleteProperty(process.env, "TRUSTED_CLIENT_IP_HEADER");
  try {
    const request = new Request("https://inventory.example/api/auth/login", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-real-ip": "203.0.113.11",
        "x-forwarded-for": "203.0.113.12",
      },
    });
    assert.equal(getClientIp(request), "unknown");
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "TRUSTED_CLIENT_IP_HEADER");
    } else {
      process.env.TRUSTED_CLIENT_IP_HEADER = previous;
    }
  }
});

test("only the explicitly trusted ingress header supplies the limiter key", () => {
  const previous = process.env.TRUSTED_CLIENT_IP_HEADER;
  process.env.TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
  try {
    const request = new Request("https://inventory.example/api/auth/login", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-real-ip": "203.0.113.11",
        "x-forwarded-for": "203.0.113.12",
      },
    });
    assert.equal(getClientIp(request), "203.0.113.11");
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "TRUSTED_CLIENT_IP_HEADER");
    } else {
      process.env.TRUSTED_CLIENT_IP_HEADER = previous;
    }
  }
});

test("unknown and existing login emails follow the same credential lookup path", async () => {
  let credentialReads = 0;
  let passwordChecks = 0;
  const repositories = {
    users: {
      findByNormalizedEmail: async () => null,
    },
    credentials: {
      findByUserId: async () => {
        credentialReads += 1;
        return null;
      },
    },
  } as unknown as UserRepositories;
  const unitOfWork: UnitOfWork<UserRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new UserService(
    unitOfWork,
    {
      hash: async () => ({ salt: "salt", hash: new Uint8Array(64) }),
      verify: async () => {
        passwordChecks += 1;
        return false;
      },
    },
    { now: () => new Date("2026-08-03T00:00:00.000Z") },
    { create: () => "11111111-1111-4111-8111-111111111111" },
  );

  assert.deepEqual(
    await service.authenticate("missing@example.com", "invalid-password"),
    { status: "invalid" },
  );
  assert.equal(credentialReads, 1);
  assert.equal(passwordChecks, 1);
});

test("login JSON limits reject wrong media and oversized chunked bodies", async () => {
  assert.throws(
    () =>
      assertLoginJsonRequest(
        new Request("https://inventory.example/api/auth/login", {
          method: "POST",
          headers: { "content-type": "text/plain" },
        }),
      ),
    (error: unknown) =>
      error instanceof ApplicationError && error.kind === "unsupported_media_type",
  );

  const request = new Request("https://inventory.example/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(MAX_LOGIN_JSON_BYTES + 1),
  });
  assertLoginJsonRequest(request);
  await assert.rejects(
    readLoginJsonRequest(request),
    (error: unknown) =>
      error instanceof ApplicationError && error.kind === "payload_too_large",
  );
});
