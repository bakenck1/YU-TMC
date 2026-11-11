import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../lib/domain/application-error";
import { createDecommissionedEnrichmentHandlers } from "../lib/server/http/decommissioned-enrichment-handler";

const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", sessionVersion: 1 } as const;
const url = "https://inventory.test/api/inventory/decommissioned/enrichment";
const input = { runId: "decommissioned-registry", planHash: "a".repeat(64) };
const request = (value: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });

test("decommissioned enrichment authenticates before reading sources or POST bodies", async () => {
  let reads = 0;
  const handlers = createDecommissionedEnrichmentHandlers({
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

test("decommissioned preview is read-only and apply receives only the exact reviewed plan", async () => {
  const previews: unknown[] = [];
  const applies: unknown[] = [];
  const handlers = createDecommissionedEnrichmentHandlers({
    authenticate: async () => actor,
    service: () => ({
      previewDecommissioned: async value => { previews.push(value); return { ...input, rows: [] }; },
      applyDecommissioned: async (value, user) => { applies.push([value, user]); return { updated: 2 }; },
    }),
  });
  const preview = await handlers.GET(new Request(url));
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), { plan: { ...input, rows: [] } });
  assert.deepEqual(previews, [actor]);
  assert.deepEqual(applies, []);
  assert.equal(preview.headers.get("cache-control"), "private, no-store");
  const result = await handlers.POST(request(input));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { result: { updated: 2 } });
  assert.deepEqual(applies, [[input, actor]]);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("decommissioned enrichment refuses non-administrators even if authentication succeeds", async () => {
  let reads = 0;
  const handlers = createDecommissionedEnrichmentHandlers({
    authenticate: async () => ({ ...actor, role: "warehouse" }),
    service: () => { reads++; throw new Error("not authorized"); },
  });
  assert.equal((await handlers.GET(new Request(url))).status, 403);
  assert.equal((await handlers.POST(request(input))).status, 403);
  assert.equal(reads, 0);
});

test("decommissioned apply rejects active and batch scopes, malformed hashes, extra fields, queries and oversized bodies", async () => {
  let serviceCalls = 0;
  const handlers = createDecommissionedEnrichmentHandlers({
    authenticate: async () => actor,
    service: () => { serviceCalls++; return { previewDecommissioned: async () => ({}), applyDecommissioned: async () => ({}) }; },
  });
  for (const body of [null, [], {}, { ...input, runId: "current-registry" }, { ...input, runId: actor.userId }, { ...input, planHash: "A".repeat(64) }, { ...input, planHash: "a".repeat(63) }, { ...input, rows: [] }]) {
    assert.equal((await handlers.POST(request(body))).status, 400);
  }
  assert.equal((await handlers.POST(request({ ...input, extra: "a".repeat(2048) }))).status, 413);
  assert.equal((await handlers.GET(new Request(`${url}?batchId=${actor.userId}`))).status, 400);
  assert.equal((await handlers.POST(new Request(`${url}?scope=current`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }))).status, 400);
  assert.equal(serviceCalls, 0);
});

test("decommissioned apply reports a stale plan without hiding its conflict status", async () => {
  const handlers = createDecommissionedEnrichmentHandlers({
    authenticate: async () => actor,
    service: () => ({
      previewDecommissioned: async () => ({}),
      applyDecommissioned: async () => { throw new ApplicationError("conflict", "inventory_audit_enrichment_stale"); },
    }),
  });
  const response = await handlers.POST(request(input));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "inventory_audit_enrichment_stale" });
});
