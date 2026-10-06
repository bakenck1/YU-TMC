import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";
import { createInventoryAuditEnrichmentHandlers } from "../lib/server/http/inventory-audit-enrichment-handler";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_HASH = "abcdef0123456789".repeat(4);
const ACTOR = { userId: "33333333-3333-4333-8333-333333333333", role: "admin", sessionVersion: 7 } as const;
const INPUT = { runId: RUN_ID, planHash: PLAN_HASH };
const URL = `https://inventory.test/api/integrations/1c/batches/${BATCH_ID}/audit/enrichment`;
const CONTEXT = { params: Promise.resolve({ id: BATCH_ID }) };

function createFixture() {
  const calls: { preview: unknown[][]; apply: unknown[][] } = { preview: [], apply: [] };
  const handlers = createInventoryAuditEnrichmentHandlers({
    authenticate: async () => ACTOR,
    service: () => ({
      preview: async (...arguments_) => {
        calls.preview.push(arguments_);
        return { runId: RUN_ID, planHash: PLAN_HASH, rows: [], counts: { ready: 0 } };
      },
      apply: async (...arguments_) => {
        calls.apply.push(arguments_);
        return { updated: 1, unchanged: 0, skipped: 0, planHash: PLAN_HASH };
      },
    }),
  });
  return { calls, handlers };
}

test("enrichment GET previews the exact batch with the authenticated actor and private no-store response", async () => {
  const { calls, handlers } = createFixture();
  const request = new Request(URL);
  Object.defineProperty(request, "body", { get: () => { throw new Error("GET must not read a body"); } });
  const response = await handlers.GET(request, CONTEXT);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { plan: { runId: RUN_ID, planHash: PLAN_HASH, rows: [], counts: { ready: 0 } } });
  assert.deepEqual(calls.preview, [[BATCH_ID, ACTOR]]);
  assert.deepEqual(calls.apply, []);
});

test("enrichment POST forwards only the exact reviewed run and hash with the authenticated actor", async () => {
  const { calls, handlers } = createFixture();
  const response = await handlers.POST(jsonRequest(INPUT), CONTEXT);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { result: { updated: 1, unchanged: 0, skipped: 0, planHash: PLAN_HASH } });
  assert.deepEqual(calls.apply, [[BATCH_ID, INPUT, ACTOR]]);
  assert.deepEqual(calls.preview, []);
});

test("authentication failure is returned before route params, URL validation, body reads, or service construction", async () => {
  for (const method of ["GET", "POST"] as const) {
    for (const [kind, status] of [["unauthorized", 401], ["forbidden", 403]] as const) {
      let paramReads = 0, bodyReads = 0, serviceCalls = 0;
      const handlers = createInventoryAuditEnrichmentHandlers({
        authenticate: async () => { throw new ApplicationError(kind, kind); },
        service: () => { serviceCalls++; throw new Error("service must not be built"); },
      });
      const request = new Request("https://inventory.test/api?invalid=query", { method });
      Object.defineProperty(request, "body", { get: () => { bodyReads++; throw new Error("body must not be read"); } });
      const context = { get params() { paramReads++; return Promise.resolve({ id: "invalid" }); } };
      const response = await handlers[method](request, context);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: kind });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(paramReads, 0);
      assert.equal(bodyReads, 0);
      assert.equal(serviceCalls, 0);
    }
  }
});

test("enrichment handlers reject malformed batch UUIDs and query strings before touching the service", async () => {
  const { calls, handlers } = createFixture();
  for (const method of ["GET", "POST"] as const) {
    for (const id of ["invalid", "11111111-1111-0111-8111-111111111111", "11111111-1111-4111-1111-111111111111", `${BATCH_ID}extra`]) {
      const response = await handlers[method](method === "POST" ? jsonRequest(INPUT) : new Request(URL), { params: Promise.resolve({ id }) });
      assert.equal(response.status, 400, `${method}: ${id}`);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    const request = method === "POST" ? jsonRequest(INPUT, `${URL}?source=excel`) : new Request(`${URL}?source=excel`);
    assert.equal((await handlers[method](request, CONTEXT)).status, 400);
  }
  assert.deepEqual(calls, { preview: [], apply: [] });
});

test("POST rejects non-object input, unknown fields, missing fields and invalid run UUIDs", async () => {
  const { calls, handlers } = createFixture();
  for (const input of [null, [], "string", 1, {}, { runId: RUN_ID }, { planHash: PLAN_HASH },
    { ...INPUT, extra: "ignored?" }, { ...INPUT, actor: ACTOR }, { ...INPUT, name: "Should not be trusted" },
    { ...INPUT, runId: 123 }, { ...INPUT, runId: null }, { ...INPUT, runId: "not-uuid" },
    { ...INPUT, runId: `${RUN_ID} ` }, { ...INPUT, runId: "22222222-2222-0222-8222-222222222222" }]) {
    const response = await handlers.POST(jsonRequest(input), CONTEXT);
    assert.equal(response.status, 400, JSON.stringify(input));
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.deepEqual(calls.apply, []);
});

test("POST requires exactly 64 lowercase hexadecimal hash characters without whitespace or coercion", async () => {
  const { calls, handlers } = createFixture();
  for (const hash of [null, 123, "", "a".repeat(63), "a".repeat(65), "g".repeat(64), "A".repeat(64), ` ${PLAN_HASH}`, `${PLAN_HASH}\n`]) {
    assert.equal((await handlers.POST(jsonRequest({ ...INPUT, planHash: hash }), CONTEXT)).status, 400, String(hash));
  }
  assert.deepEqual(calls.apply, []);
});

test("POST accepts explicit JSON charset and mixed-case media type while rejecting other or absent types", async () => {
  const { calls, handlers } = createFixture();
  for (const contentType of ["application/json; charset=utf-8", "APPLICATION/JSON"]) {
    const response = await handlers.POST(new Request(URL, { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(INPUT) }), CONTEXT);
    assert.equal(response.status, 200);
  }
  for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "application/jsonp"]) {
    const headers = contentType ? { "content-type": contentType } : {};
    const response = await handlers.POST(new Request(URL, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(INPUT)) }), CONTEXT);
    assert.equal(response.status, 415, String(contentType));
    assert.deepEqual(await response.json(), { error: "unsupported_media_type" });
  }
  assert.equal(calls.apply.length, 2);
});

test("POST rejects malformed JSON and invalid UTF-8 without applying any plan", async () => {
  const { calls, handlers } = createFixture();
  for (const body of ["{", `${JSON.stringify(INPUT)} trailing`, new Uint8Array([0xff, 0xfe])]) {
    const response = await handlers.POST(new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body }), CONTEXT);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.deepEqual(calls.apply, []);
});

test("POST bounds actual streamed bytes and declared content length to 1024 bytes", async () => {
  const { calls, handlers } = createFixture();
  const request = new Request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...INPUT, padding: "x".repeat(1024) }) });
  const response = await handlers.POST(request, CONTEXT);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "payload_too_large" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");

  const declared = new Request(URL, { method: "POST", headers: { "content-type": "application/json", "content-length": "1025" }, body: JSON.stringify(INPUT) });
  Object.defineProperty(declared, "body", { get: () => { throw new Error("oversize declared body should not be read"); } });
  assert.equal((await handlers.POST(declared, CONTEXT)).status, 413);
  assert.deepEqual(calls.apply, []);
});

test("POST validates content-length rather than trusting malformed or unsafe declarations", async () => {
  const { calls, handlers } = createFixture();
  for (const [length, status] of [["abc", 400], ["-1", 400], ["1.5", 400], ["9007199254740992", 413]] as const) {
    const response = await handlers.POST(new Request(URL, { method: "POST", headers: { "content-type": "application/json", "content-length": length }, body: JSON.stringify(INPUT) }), CONTEXT);
    assert.equal(response.status, status, length);
  }
  assert.deepEqual(calls.apply, []);
});

test("GET and POST retain the stale-plan domain conflict with private no-store responses", async () => {
  const handlers = createInventoryAuditEnrichmentHandlers({
    authenticate: async () => ACTOR,
    service: () => ({
      preview: async () => { throw new ApplicationError("conflict", "inventory_audit_enrichment_stale"); },
      apply: async () => { throw new ApplicationError("conflict", "inventory_audit_enrichment_stale"); },
    }),
  });
  for (const response of [await handlers.GET(new Request(URL), CONTEXT), await handlers.POST(jsonRequest(INPUT), CONTEXT)]) {
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "inventory_audit_enrichment_stale" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("a rolled-back shared-number violation is a private domain conflict, not an uncertain server failure", async () => {
  const handlers = createInventoryAuditEnrichmentHandlers({
    authenticate: async () => ACTOR,
    service: () => ({
      preview: async () => ({}),
      apply: async () => { throw new ApplicationError("conflict", "inventory_audit_enrichment_shared_number_conflict"); },
    }),
  });
  const response = await handlers.POST(jsonRequest(INPUT), CONTEXT);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "inventory_audit_enrichment_shared_number_conflict" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("unexpected errors hide internal details and remain uncached", async () => {
  const handlers = createInventoryAuditEnrichmentHandlers({
    authenticate: async () => ACTOR,
    service: () => ({
      preview: async () => { throw new Error("private database connection secret"); },
      apply: async () => { throw new Error("private database connection secret"); },
    }),
  });
  const response = await handlers.POST(jsonRequest(INPUT), CONTEXT);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

function jsonRequest(input: unknown, url = URL) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}
