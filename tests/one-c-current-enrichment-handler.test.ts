import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../lib/domain/application-error";
import { createOneCCurrentEnrichmentHandlers } from "../lib/server/http/one-c-current-enrichment-handler";

const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", sessionVersion: 1 } as const;
const url = "https://inventory.test/api/integrations/1c/enrichment";
const input = { runId: "current-registry", planHash: "a".repeat(64) };
const request = (value: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });

test("global enrichment authenticates before reading either registry or any POST body", async () => {
  let reads = 0;
  const handlers = createOneCCurrentEnrichmentHandlers({
    authenticate: async () => { throw new ApplicationError("forbidden", "forbidden"); },
    service: () => { reads++; throw new Error("not authorized"); },
  });
  for (const method of ["GET", "POST"] as const) {
    const req = method === "GET" ? new Request(url) : request(input);
    const response = await handlers[method](req);
    assert.equal(response.status, 403);
    assert.equal(req.bodyUsed, false);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(reads, 0);
});

test("preview and apply target the full current registry with the exact reviewed hash", async () => {
  const calls: unknown[] = [];
  const handlers = createOneCCurrentEnrichmentHandlers({
    authenticate: async () => actor,
    service: () => ({
      previewCurrent: async value => { calls.push(value); return { ...input, rows: [] }; },
      applyCurrent: async (value, user) => { calls.push([value, user]); return { updated: 2 }; },
    }),
  });
  const preview = await handlers.GET(new Request(url));
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), { plan: { ...input, rows: [] } });
  const result = await handlers.POST(request(input));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { result: { updated: 2 } });
  assert.deepEqual(calls, [actor, [input, actor]]);
});

test("global apply rejects batch scopes, malformed hashes, extra fields and oversized bodies", async () => {
  let applies = 0;
  const handlers = createOneCCurrentEnrichmentHandlers({
    authenticate: async () => actor,
    service: () => ({ previewCurrent: async () => ({}), applyCurrent: async () => { applies++; return {}; } }),
  });
  for (const body of [null, [], {}, { ...input, runId: actor.userId }, { ...input, planHash: "A".repeat(64) }, { ...input, planHash: "a".repeat(63) }, { ...input, rows: [] }]) {
    assert.equal((await handlers.POST(request(body))).status, 400);
  }
  assert.equal((await handlers.POST(request({ ...input, extra: "a".repeat(2048) }))).status, 413);
  assert.equal((await handlers.GET(new Request(`${url}?batchId=${actor.userId}`))).status, 400);
  assert.equal(applies, 0);
});
