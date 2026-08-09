import assert from "node:assert/strict";
import test from "node:test";

import { createTmcTransferRequestDecisionPostHandler } from "../lib/server/http/tmc-transfer-request-decision-handler";
import { ApplicationError } from "../lib/domain/application-error";

test("decision POST forwards authenticated actor, path scope and idempotency key", async () => {
  const calls: unknown[] = [];
  const handler = createTmcTransferRequestDecisionPostHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async decideIdempotent(requestId, input, actor, key) {
      calls.push({ requestId, input, actor, key });
      return { body: { request: { id: requestId } as never }, kind: "completed", status: 200 };
    },
  });
  const response = await handler(jsonRequest({
    requestVersion: 1,
    decisions: [{ itemId: "11111111-1111-4111-8111-111111111111", itemVersion: 2, decision: "accept" }],
  }), "22222222-2222-4222-8222-222222222222");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { actor: unknown }).actor, { userId: "actor", role: "employee" });
});

test("decision POST exposes replay and bounded retry headers", async () => {
  const outcomes = [
    { body: { request: { id: "request" } as never }, kind: "replayed" as const, status: 200 as const },
    new ApplicationError("conflict", "idempotency_request_in_progress"),
    new ApplicationError("rate_limited", "rate_limited", { safeDetails: { retryAfterSeconds: "7" } }),
  ];
  const handler = createTmcTransferRequestDecisionPostHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async decideIdempotent() {
      const outcome = outcomes.shift()!;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  });
  const replay = await handler(jsonRequest({ requestVersion: 1, decisions: [] }), "request");
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  const inProgress = await handler(jsonRequest({ requestVersion: 1, decisions: [] }), "request");
  assert.equal(inProgress.status, 409);
  assert.equal(inProgress.headers.get("retry-after"), "1");
  const limited = await handler(jsonRequest({ requestVersion: 1, decisions: [] }), "request");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "7");
});

test("decision POST rejects unsupported, malformed and oversized payloads before mutation", async () => {
  let calls = 0;
  const handler = createTmcTransferRequestDecisionPostHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async decideIdempotent() { calls += 1; throw new Error("must not run"); },
  });
  const requests = [
    new Request("https://example.test/api", { method: "POST", headers: { "content-type": "text/plain", "idempotency-key": "tmc-decision-000001" }, body: "{}" }),
    new Request("https://example.test/api", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "tmc-decision-000001" }, body: "{" }),
    new Request("https://example.test/api", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "tmc-decision-000001" }, body: JSON.stringify({ requestVersion: 1, decisions: [], padding: "x".repeat(17_000) }) }),
  ];
  assert.equal((await handler(requests[0]!, "request")).status, 415);
  assert.equal((await handler(requests[1]!, "request")).status, 400);
  assert.equal((await handler(requests[2]!, "request")).status, 413);
  assert.equal(calls, 0);
});

test("decision POST rejects unknown fields and missing idempotency key", async () => {
  const handler = createTmcTransferRequestDecisionPostHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async decideIdempotent() { throw new Error("must not run"); },
  });
  for (const request of [
    new Request("https://example.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestVersion: 1, decisions: [], actorId: "spoof" }) }),
    new Request("https://example.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestVersion: 1, decisions: [] }) }),
  ]) {
    const response = await handler(request, "22222222-2222-4222-8222-222222222222");
    assert.equal(response.status, 400);
  }
});

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "tmc-decision-000001" },
    body: JSON.stringify(body),
  });
}
