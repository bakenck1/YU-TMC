import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { TransferDto } from "../lib/contracts/inventory-responsibility";
import { ApplicationError } from "../lib/domain/application-error";
import { createInventoryTransferOverridePostHandler } from "../lib/server/http/inventory-transfer-override-handler";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const RESPONSIBLE_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR = {
  userId: "33333333-3333-4333-8333-333333333333",
  role: "admin" as const,
  sessionVersion: 7,
};

test("legacy override forwards a canonical ID, strict command and complete session actor", async () => {
  const calls: unknown[] = [];
  const handler = createInventoryTransferOverridePostHandler({
    authenticate: async () => ACTOR,
    overrideTransfer: async (id, input, actor) => {
      calls.push({ id, input, actor });
      return transferDto(id);
    },
  });

  const response = await handler(jsonRequest({
    version: 3,
    reason: "  Emergency reassignment  ",
    outcome: "assigned",
    responsibleUserId: RESPONSIBLE_ID.toUpperCase(),
  }), TRANSFER_ID.toUpperCase());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { transfer: transferDto(TRANSFER_ID) });
  assert.deepEqual(calls, [{
    id: TRANSFER_ID,
    input: {
      version: 3,
      reason: "  Emergency reassignment  ",
      outcome: "assigned",
      responsibleUserId: RESPONSIBLE_ID.toUpperCase(),
    },
    actor: ACTOR,
  }]);
});

test("malformed and missing override IDs are hidden identically after authentication", async () => {
  let calls = 0;
  let authentications = 0;
  const handler = createInventoryTransferOverridePostHandler({
    authenticate: async () => {
      authentications += 1;
      return ACTOR;
    },
    overrideTransfer: async () => {
      calls += 1;
      throw new ApplicationError("not_found", "transfer_not_found");
    },
  });

  const malformed = await handler(releaseRequest(), "not-a-uuid");
  const missing = await handler(releaseRequest(), TRANSFER_ID);

  for (const response of [malformed, missing]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "transfer_not_found" });
  }
  assert.equal(authentications, 2);
  assert.equal(calls, 1);
});

test("authentication and same-origin failures precede identifier and body validation", async () => {
  const failures = [
    new ApplicationError("unauthorized", "unauthorized"),
    new ApplicationError("forbidden", "cross_site_request_blocked"),
  ];
  let calls = 0;
  const handler = createInventoryTransferOverridePostHandler({
    authenticate: async () => {
      throw failures.shift();
    },
    overrideTransfer: async () => {
      calls += 1;
      throw new Error("must_not_run");
    },
  });
  const invalidRequest = () => new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "not-json",
  });

  const unauthenticated = await handler(invalidRequest(), "not-a-uuid");
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
  assert.deepEqual(await unauthenticated.json(), { error: "unauthorized" });

  const crossSite = await handler(invalidRequest(), "not-a-uuid");
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.headers.get("cache-control"), "no-store");
  assert.deepEqual(await crossSite.json(), { error: "cross_site_request_blocked" });
  assert.equal(calls, 0);
});

test("legacy override rejects mass assignment, outcome/target ambiguity and int4 overflow", async () => {
  let calls = 0;
  const handler = createInventoryTransferOverridePostHandler({
    authenticate: async () => ACTOR,
    overrideTransfer: async () => {
      calls += 1;
      throw new Error("must_not_run");
    },
  });
  const invalidBodies = [
    null,
    [],
    {},
    { version: 0, reason: "reason", outcome: "released" },
    { version: 1.5, reason: "reason", outcome: "released" },
    { version: 2_147_483_648, reason: "reason", outcome: "released" },
    { version: 1, reason: "reason", outcome: "assigned" },
    { version: 1, reason: "reason", outcome: "assigned", responsibleUserId: null },
    { version: 1, reason: "reason", outcome: "released", responsibleUserId: RESPONSIBLE_ID },
    { version: 1, reason: "reason", outcome: "unknown" },
    { version: 1, reason: "reason", outcome: "released", actorId: ACTOR.userId },
    { version: 1, reason: "reason", outcome: "released", closedBy: ACTOR.userId },
    { version: 1, reason: "reason", outcome: "released", itemId: RESPONSIBLE_ID },
    { version: 1, reason: "reason", outcome: "released", status: "overridden" },
    { version: 1, reason: { text: "reason" }, outcome: "released" },
  ];

  for (const body of invalidBodies) {
    const response = await handler(jsonRequest(body), TRANSFER_ID);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls, 0);
});

test("legacy override bounds JSON, preserves no-store and sanitizes Retry-After", async () => {
  const outcomes: unknown[] = [
    new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "9" },
    }),
    new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: "\r\nunsafe" },
    }),
  ];
  const handler = createInventoryTransferOverridePostHandler({
    authenticate: async () => {
      const outcome = outcomes.shift();
      if (outcome) throw outcome;
      return ACTOR;
    },
    overrideTransfer: async () => {
      throw new Error("must_not_run");
    },
  });

  const limited = await handler(releaseRequest(), TRANSFER_ID);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "9");
  assert.equal(limited.headers.get("cache-control"), "no-store");

  const unsafe = await handler(releaseRequest(), TRANSFER_ID);
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

  const malformedJson = await handler(new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }), TRANSFER_ID);
  assert.equal(malformedJson.status, 400);
  assert.equal(malformedJson.headers.get("cache-control"), "no-store");

  const oversized = await handler(jsonRequest({
    version: 1,
    reason: "x".repeat(17_000),
    outcome: "released",
  }), TRANSFER_ID);
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store");
});

test("legacy override route keeps CSRF/rate/session authentication and does not drop sessionVersion", async () => {
  const source = await readFile(
    "app/api/inventory/transfers/[id]/override/route.ts",
    "utf8",
  );
  assert.match(source, /createInventoryTransferOverridePostHandler/);
  assert.match(source, /authenticate:\s*requireCurrentUser/);
  assert.doesNotMatch(source, /authorizationActor/);
});

function releaseRequest() {
  return jsonRequest({ version: 1, reason: "Administrative release", outcome: "released" });
}

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
    status: "overridden",
    requestedAt: "2026-08-13T07:00:00.000Z",
    closedAt: "2026-08-13T08:00:00.000Z",
    decisionComment: null,
    version: 4,
    direction: "outgoing",
  };
}
