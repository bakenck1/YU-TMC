import assert from "node:assert/strict";
import test from "node:test";

import type { TransferDto } from "../lib/contracts/inventory-responsibility";
import { ApplicationError } from "../lib/domain/application-error";
import { createInventoryTransferDecisionPostHandler } from "../lib/server/http/inventory-transfer-decision-handler";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";

test("legacy transfer decision forwards only the authenticated actor and strict input", async () => {
  const calls: unknown[] = [];
  const handler = createInventoryTransferDecisionPostHandler({
    async authenticate() {
      return {
        userId: "22222222-2222-4222-8222-222222222222",
        role: "employee",
        sessionVersion: 7,
      };
    },
    async decideTransfer(id, input, actor) {
      calls.push({ id, input, actor });
      return { id } as TransferDto;
    },
  });

  const response = await handler(
    jsonRequest({ version: 3, decision: "reject", comment: "  Duplicate  " }),
    TRANSFER_ID,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [
    {
      id: TRANSFER_ID,
      input: { version: 3, decision: "reject", comment: "  Duplicate  " },
      actor: {
        userId: "22222222-2222-4222-8222-222222222222",
        role: "employee",
        sessionVersion: 7,
      },
    },
  ]);
});

test("malformed, missing and foreign transfer identifiers have one hidden response", async () => {
  let calls = 0;
  const handler = createInventoryTransferDecisionPostHandler({
    async authenticate() {
      return {
        userId: "22222222-2222-4222-8222-222222222222",
        role: "employee",
        sessionVersion: 1,
      };
    },
    async decideTransfer() {
      calls += 1;
      throw new ApplicationError("not_found", "transfer_not_found");
    },
  });

  const malformed = await handler(
    jsonRequest({ version: 1, decision: "confirm" }),
    "not-a-uuid",
  );
  const missing = await handler(
    jsonRequest({ version: 1, decision: "confirm" }),
    TRANSFER_ID,
  );
  const foreign = await handler(
    jsonRequest({ version: 1, decision: "confirm" }),
    "33333333-3333-4333-8333-333333333333",
  );

  for (const response of [malformed, missing, foreign]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "transfer_not_found" });
  }
  assert.equal(calls, 2);
});

test("legacy decision rejects mass-assignment fields and non-PostgreSQL versions", async () => {
  let calls = 0;
  const handler = createInventoryTransferDecisionPostHandler({
    async authenticate() {
      return {
        userId: "22222222-2222-4222-8222-222222222222",
        role: "employee",
        sessionVersion: 1,
      };
    },
    async decideTransfer() {
      calls += 1;
      throw new Error("must not run");
    },
  });
  const invalidBodies = [
    { version: 1, decision: "confirm", actorId: "spoofed" },
    { version: 1, decision: "confirm", itemId: "spoofed" },
    { version: 0, decision: "confirm" },
    { version: 2_147_483_648, decision: "confirm" },
    { version: 1.5, decision: "confirm" },
    { version: 1, decision: "reject", comment: { text: "spoofed" } },
  ];

  for (const body of invalidBodies) {
    const response = await handler(jsonRequest(body), TRANSFER_ID);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls, 0);
});

test("legacy decision bounds media type and body size and keeps errors non-cacheable", async () => {
  const handler = createInventoryTransferDecisionPostHandler({
    async authenticate() {
      return {
        userId: "22222222-2222-4222-8222-222222222222",
        role: "employee",
        sessionVersion: 1,
      };
    },
    async decideTransfer() {
      throw new Error("must not run");
    },
  });
  const requests = [
    new Request("https://example.test/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
    new Request("https://example.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    jsonRequest({
      version: 1,
      decision: "reject",
      comment: "x".repeat(17_000),
    }),
  ];
  const expected = [415, 400, 413];
  for (let index = 0; index < requests.length; index += 1) {
    const response = await handler(requests[index]!, TRANSFER_ID);
    assert.equal(response.status, expected[index]);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
