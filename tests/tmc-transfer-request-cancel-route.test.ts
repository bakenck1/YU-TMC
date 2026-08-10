import assert from "node:assert/strict";
import test from "node:test";

import { createTmcTransferRequestCancelPostHandler } from "../lib/server/http/tmc-transfer-request-cancel-handler";

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = { userId: "11111111-1111-4111-8111-111111111111", role: "employee" as const };

test("cancel route requires strict JSON and forwards server identity plus idempotency key", async () => {
  const calls: unknown[][] = [];
  const handler = createTmcTransferRequestCancelPostHandler({
    authenticate: async () => ACTOR,
    cancelIdempotent: async (...args) => {
      calls.push(args);
      return { status: 200 as const, kind: "completed" as const, body: { request: { id: REQUEST_ID } as never } };
    },
  });
  const response = await handler(new Request("https://inventory.example/cancel", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "tmc-cancel-000001" },
    body: JSON.stringify({ requestVersion: 1 }),
  }), REQUEST_ID);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [[REQUEST_ID, { requestVersion: 1 }, ACTOR, "tmc-cancel-000001"]]);
});

test("cancel route rejects identity injection, unknown fields and non-json bodies", async () => {
  let calls = 0;
  const handler = createTmcTransferRequestCancelPostHandler({
    authenticate: async () => ACTOR,
    cancelIdempotent: async () => { calls += 1; throw new Error("must_not_run"); },
  });
  for (const request of [
    new Request("https://inventory.example/cancel", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "tmc-cancel-000001" }, body: JSON.stringify({ requestVersion: 1, actorId: ACTOR.userId }) }),
    new Request("https://inventory.example/cancel", { method: "POST", headers: { "content-type": "text/plain", "idempotency-key": "tmc-cancel-000001" }, body: "{}" }),
  ]) {
    const response = await handler(request, REQUEST_ID);
    assert.ok([400, 415].includes(response.status));
  }
  assert.equal(calls, 0);
});
