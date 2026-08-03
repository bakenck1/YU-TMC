import assert from "node:assert/strict";
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
