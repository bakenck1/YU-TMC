import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";
import { createAssetLossCollectionHandlers, createAssetLossReceiptHandlers, createAssetLossReviewHandler } from "../lib/server/http/asset-loss-handlers";

const ACTOR = { userId: "11111111-1111-4111-8111-111111111111", role: "employee" as const, sessionVersion: 1 };
const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("collection boundary rejects unknown query/body fields and oversized JSON", async () => {
  const handler = createAssetLossCollectionHandlers({ authenticate: async () => ACTOR, service: { list: async () => ({ lossCases: [], nextCursor: null }), create: async () => { throw new Error("must not run"); } } });
  const query = await handler.GET(new Request("https://inventory.example/api/inventory/loss-cases?limit=5"));
  assert.equal(query.status, 400); assert.deepEqual(await query.json(), { error: "invalid_loss_query" });
  const unknown = await handler.POST(jsonRequest({ itemId: CASE_ID, admin: true }));
  assert.equal(unknown.status, 400); assert.deepEqual(await unknown.json(), { error: "invalid_loss_request" });
  const oversized = await handler.POST(new Request("https://inventory.example/api/inventory/loss-cases", { method: "POST", headers: { "content-type": "application/json", "content-length": "999999" }, body: "{}" }));
  assert.equal(oversized.status, 413); assert.equal(oversized.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("boundaries authenticate before reading bodies and never expose unexpected errors", async () => {
  let created = false;
  const handler = createAssetLossCollectionHandlers({ authenticate: async () => { throw new ApplicationError("unauthorized", "unauthorized"); }, service: { list: async () => ({ lossCases: [], nextCursor: null }), create: async () => { created = true; throw new Error(); } } });
  const unauthorized = await handler.POST(new Request("https://inventory.example/api/inventory/loss-cases", { method: "POST", body: "not json" }));
  assert.equal(unauthorized.status, 401); assert.equal(created, false);
  const unavailable = createAssetLossReviewHandler({ authenticate: async () => ({ ...ACTOR, role: "admin" }), service: { review: async () => { throw new Error("postgres secret"); } } });
  const response = await unavailable(jsonRequest({ decision: "approved" }), CASE_ID);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "loss_review_unavailable" });
});

test("receipt boundary enforces exact JSON shape and forwards normalized bytes", async () => {
  const calls: unknown[] = [];
  const handlers = createAssetLossReceiptHandlers({
    authenticate: async () => ACTOR,
    normalize: async (value) => { calls.push(value); return { bytes: new Uint8Array([7]), width: 1, height: 1, mediaType: "image/jpeg" }; },
    service: { getReceipt: async () => ({ bytes: new Uint8Array([7]), mediaType: "image/jpeg" }), submitReceipt: async (...args) => { calls.push(args); return { id: CASE_ID } as never; } },
  });
  const invalid = await handlers.POST(jsonRequest({ photo: { imageDataUrl: "x", extra: true } }), CASE_ID);
  assert.equal(invalid.status, 400);
  const malformed = await handlers.POST(new Request("https://inventory.example/api/inventory/loss-cases", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }), CASE_ID);
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: "invalid_loss_receipt" });
  const response = await handlers.POST(jsonRequest({ photo: { imageDataUrl: "data:image/jpeg;base64,eA==" } }), CASE_ID);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(calls[0], "data:image/jpeg;base64,eA==");
});

test("production routes delegate through authenticated CSRF-aware request-user guards", () => {
  const collection = readFileSync(path.join("app", "api", "inventory", "loss-cases", "route.ts"), "utf8");
  const receipt = readFileSync(path.join("app", "api", "inventory", "loss-cases", "[id]", "receipt", "route.ts"), "utf8");
  const review = readFileSync(path.join("app", "api", "inventory", "loss-cases", "[id]", "review", "route.ts"), "utf8");
  assert.match(collection, /requireCurrentUser\(request\)/); assert.match(receipt, /requireCurrentUser\(request\)/);
  assert.match(review, /requirePermission\(request, "inventory\.item\.manage_protected_fields"\)/);
});

function jsonRequest(body: unknown) { return new Request("https://inventory.example/api/inventory/loss-cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
