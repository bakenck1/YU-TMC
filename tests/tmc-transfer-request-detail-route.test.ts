import assert from "node:assert/strict";
import test from "node:test";

import { createTmcTransferRequestDetailGetHandler } from "../lib/server/http/tmc-transfer-request-detail-handler";
import { createTmcTransferRequestPhotoGetHandler } from "../lib/server/http/tmc-transfer-request-photo-handler";
import { ApplicationError } from "../lib/domain/application-error";

test("detail endpoint authenticates server actor and returns a private request", async () => {
  const calls: unknown[] = [];
  const request = { id: "request" } as never;
  const handler = createTmcTransferRequestDetailGetHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async getById(id, actor) { calls.push({ id, actor }); return request; },
  });
  const response = await handler(new Request("https://example.test/api"), "request-id");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { request });
  assert.deepEqual(calls, [{ id: "request-id", actor: { userId: "actor", role: "employee" } }]);
});

test("detail endpoint hides unexpected failures", async () => {
  const handler = createTmcTransferRequestDetailGetHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async getById() { throw new Error("database details"); },
  });
  const response = await handler(new Request("https://example.test/api"), "id");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
});

test("detail endpoint preserves hidden not-found with no-store", async () => {
  const handler = createTmcTransferRequestDetailGetHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async getById() { throw new ApplicationError("not_found", "request_not_found"); },
  });
  const response = await handler(new Request("https://example.test/api"), "id");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "request_not_found" });
});

test("photo endpoint returns exact JPEG bytes and authenticated actor", async () => {
  const calls: unknown[] = [];
  const handler = createTmcTransferRequestPhotoGetHandler({
    async authenticate() { return { userId: "actor", role: "employee" }; },
    async getItemPhoto(requestId, itemId, actor) {
      calls.push({ requestId, itemId, actor });
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
    },
  });
  const response = await handler(new Request("https://example.test/photo"), "request", "item");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.deepEqual(calls, [{ requestId: "request", itemId: "item", actor: { userId: "actor", role: "employee" } }]);
});

test("photo endpoint safely maps auth, scope and unexpected failures", async () => {
  for (const [error, status, body] of [
    [new ApplicationError("unauthorized", "unauthorized"), 401, { error: "unauthorized" }],
    [new ApplicationError("not_found", "request_not_found"), 404, { error: "request_not_found" }],
    [new Error("secret database details"), 503, { error: "photo_unavailable" }],
  ] as const) {
    const handler = createTmcTransferRequestPhotoGetHandler({
      async authenticate() { if (status === 401) throw error; return { userId: "actor", role: "employee" }; },
      async getItemPhoto() { throw error; },
    });
    const response = await handler(new Request("https://example.test/photo"), "request", "item");
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), body);
  }
});
