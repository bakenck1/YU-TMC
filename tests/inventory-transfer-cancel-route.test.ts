import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { TransferDto } from "../lib/contracts/inventory-responsibility";
import { ApplicationError } from "../lib/domain/application-error";
import { createInventoryTransferCancelPostHandler } from "../lib/server/http/inventory-transfer-cancel-handler";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const UPPERCASE_TRANSFER_ID = TRANSFER_ID.toUpperCase();
const ACTOR = {
  userId: "22222222-2222-4222-8222-222222222222",
  role: "employee" as const,
  sessionVersion: 7,
};

test("legacy transfer cancellation forwards only strict input and the complete authenticated actor", async () => {
  const calls: unknown[] = [];
  const handler = createInventoryTransferCancelPostHandler({
    authenticate: async () => ACTOR,
    cancelTransfer: async (id, version, actor) => {
      calls.push({ id, version, actor });
      return transferDto(id);
    },
  });

  const response = await handler(jsonRequest({ version: 3 }), UPPERCASE_TRANSFER_ID);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { transfer: transferDto(TRANSFER_ID) });
  assert.deepEqual(calls, [{ id: TRANSFER_ID, version: 3, actor: ACTOR }]);
});

test("malformed, missing and foreign cancellation identifiers have one hidden response", async () => {
  let calls = 0;
  const handler = createInventoryTransferCancelPostHandler({
    authenticate: async () => ACTOR,
    cancelTransfer: async () => {
      calls += 1;
      throw new ApplicationError("not_found", "transfer_not_found");
    },
  });

  const responses = await Promise.all([
    handler(jsonRequest({ version: 1 }), "not-a-uuid"),
    handler(jsonRequest({ version: 1 }), TRANSFER_ID),
    handler(
      jsonRequest({ version: 1 }),
      "33333333-3333-4333-8333-333333333333",
    ),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "transfer_not_found" });
  }
  assert.equal(calls, 2);
});

test("legacy cancellation rejects mass assignment and non-PostgreSQL versions", async () => {
  let calls = 0;
  const handler = createInventoryTransferCancelPostHandler({
    authenticate: async () => ACTOR,
    cancelTransfer: async () => {
      calls += 1;
      throw new Error("must_not_run");
    },
  });
  const invalidBodies = [
    null,
    [],
    {},
    { version: 0 },
    { version: 1.5 },
    { version: 2_147_483_648 },
    { version: 1, actorId: ACTOR.userId },
    { version: 1, requestedBy: ACTOR.userId },
    { version: 1, closedBy: ACTOR.userId },
    { version: 1, status: "cancelled" },
    { version: 1, administrativeReason: "override" },
  ];

  for (const body of invalidBodies) {
    const response = await handler(jsonRequest(body), TRANSFER_ID);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls, 0);
});

test("legacy cancellation bounds media type and body size and sanitizes retry headers", async () => {
  const outcomes: unknown[] = [
    new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "7" },
    }),
    new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "\r\nunsafe" },
    }),
  ];
  const handler = createInventoryTransferCancelPostHandler({
    authenticate: async () => {
      const outcome = outcomes.shift();
      if (outcome) throw outcome;
      return ACTOR;
    },
    cancelTransfer: async () => {
      throw new Error("must_not_run");
    },
  });

  const limited = await handler(jsonRequest({ version: 1 }), TRANSFER_ID);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "7");
  assert.equal(limited.headers.get("cache-control"), "no-store");

  const unsafe = await handler(jsonRequest({ version: 1 }), TRANSFER_ID);
  assert.equal(unsafe.status, 429);
  assert.equal(unsafe.headers.get("retry-after"), null);
  assert.equal(unsafe.headers.get("cache-control"), "no-store");

  const nonJson = await handler(new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }), TRANSFER_ID);
  assert.equal(nonJson.status, 415);
  assert.equal(nonJson.headers.get("cache-control"), "no-store");

  const malformed = await handler(new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }), TRANSFER_ID);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("cache-control"), "no-store");

  const oversized = await handler(jsonRequest({
    version: 1,
    padding: "x".repeat(5_000),
  }), TRANSFER_ID);
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store");
});

test("legacy cancellation route preserves CSRF, rate-limit and session-version authentication", async () => {
  const source = await readFile(
    "app/api/inventory/transfers/[id]/cancel/route.ts",
    "utf8",
  );
  assert.match(source, /createInventoryTransferCancelPostHandler/);
  assert.match(source, /authenticate:\s*requireCurrentUser/);
  assert.doesNotMatch(source, /authorizationActor/);
});

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function transferDto(id: string): TransferDto {
  return {
    id,
    itemId: "44444444-4444-4444-8444-444444444444",
    itemName: "Laptop",
    itemInventoryNumber: "INV-1",
    requestedByName: "Requester",
    status: "cancelled",
    requestedAt: "2026-08-13T07:00:00.000Z",
    closedAt: "2026-08-13T08:00:00.000Z",
    decisionComment: null,
    version: 4,
    direction: "outgoing",
  };
}
