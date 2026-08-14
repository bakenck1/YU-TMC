import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isUuid } from "../lib/domain/identifiers";
import { requireSameOriginMutation } from "../lib/security/request-integrity";

test("accepts canonical UUIDs and rejects permissive ID lookalikes", () => {
  assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isUuid("------------------------------------"), false);
  assert.equal(isUuid("550e8400e29b41d4a716446655440000----"), false);
  assert.equal(isUuid("550e8400-e29b-01d4-a716-446655440000"), false);
});

test("blocks cross-site cookie-auth mutations", () => {
  assert.throws(
    () =>
      requireSameOriginMutation(
        new Request("https://inventory.example/api/items", {
          method: "POST",
          headers: {
            origin: "https://attacker.example",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    /cross_site_request_blocked/,
  );
});

test("allows same-origin mutations and safe cross-site reads", () => {
  assert.doesNotThrow(() =>
    requireSameOriginMutation(
      new Request("https://inventory.example/api/items", {
        method: "POST",
        headers: { origin: "https://inventory.example" },
      }),
    ),
  );
  assert.doesNotThrow(() =>
    requireSameOriginMutation(
      new Request("https://inventory.example/api/items", {
        headers: { origin: "https://attacker.example" },
      }),
    ),
  );
});

test("uses the external Host header when Next is bound to Docker's 0.0.0.0", () => {
  assert.doesNotThrow(() =>
    requireSameOriginMutation(
      new Request("http://0.0.0.0:3000/api/items", {
        method: "POST",
        headers: {
          host: "172.20.10.2:3000",
          origin: "http://172.20.10.2:3000",
        },
      }),
    ),
  );
  assert.throws(
    () =>
      requireSameOriginMutation(
        new Request("http://0.0.0.0:3000/api/items", {
          method: "POST",
          headers: {
            host: "172.20.10.2:3000",
            origin: "http://attacker.example",
          },
        }),
      ),
    /cross_site_request_blocked/,
  );
});

test("uses the forwarded HTTPS protocol behind the trusted local reverse proxy", () => {
  assert.doesNotThrow(() =>
    requireSameOriginMutation(
      new Request("http://app:3000/api/service-requests/request-id", {
        method: "PATCH",
        headers: {
          host: "172.20.10.2",
          origin: "https://172.20.10.2",
          "x-forwarded-proto": "https",
        },
      }),
    ),
  );
  assert.throws(
    () =>
      requireSameOriginMutation(
        new Request("http://app:3000/api/service-requests/request-id", {
          method: "PATCH",
          headers: {
            host: "172.20.10.2",
            origin: "https://attacker.example",
            "x-forwarded-proto": "https",
          },
        }),
      ),
    /cross_site_request_blocked/,
  );
});

test("production API limiting uses the durable database bucket", () => {
  const source = readFileSync("lib/security/rate-limiter.ts", "utf8");
  assert.match(source, /export function consumeApiRateLimit\(request: Request\): Promise/);
  assert.match(source, /namespace: "api-by-ip-v2"/);
  assert.match(source, /process\.env\.NODE_ENV !== "test"/);
});

test("production runtime packaging removes source maps", () => {
  const dockerfile = readFileSync("Dockerfile.mobile", "utf8");
  const securityCheck = readFileSync("scripts/security-check.mjs", "utf8");
  const nextConfig = readFileSync("next.config.ts", "utf8");
  assert.match(dockerfile, /find \/app\/\.next -type f -name '\*\.map' -delete/);
  assert.match(securityCheck, /entry\.name\.endsWith\("\.map"\)/);
  assert.match(nextConfig, /turbopackSourceMaps: false/);
  assert.match(nextConfig, /serverSourceMaps: false/);
});
