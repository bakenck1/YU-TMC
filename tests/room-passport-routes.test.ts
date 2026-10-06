import assert from "node:assert/strict";
import { test } from "node:test";
import { ApplicationError } from "@/lib/domain/application-error";
import { createPassportHandlers } from "@/lib/server/http/room-passport-handlers";
import type { PassportActor } from "@/lib/application/services/room-passport-service";
import { MAX_PASSPORT_BYTES } from "@/lib/contracts/room-passports";

const roomId = "11111111-1111-4111-8111-111111111111";
const actor: PassportActor = { userId: roomId, role: "passport_author", sessionVersion: 1 };
function handlers(authenticate = async () => actor) {
  const calls: unknown[][] = [];
  return { calls, api: createPassportHandlers({ authenticate, service: {
    list: async () => [],
    find: async () => { throw new ApplicationError("not_found", "room_not_found"); },
    mutate: async (...args) => { calls.push(args); throw new ApplicationError("conflict", "passport_conflict"); },
    file: async (...args) => { calls.push(args); return { bytes: new Uint8Array([1, 2]), name: "паспорт.pdf" }; },
  } }) };
}
test("passport APIs authenticate file viewing and gate every management operation", async () => {
  const unauthenticated = handlers(async () => { throw new ApplicationError("unauthorized", "unauthorized"); });
  assert.equal((await unauthenticated.api.file(new Request(`https://app.test/file?fileId=${roomId}`), roomId, true)).status, 401);
  assert.equal(unauthenticated.calls.length, 0);
  for (const role of ["employee", "warehouse", "typography"] as const) {
    const { api, calls } = handlers(async () => ({ ...actor, role }));
    assert.equal((await api.list(new Request("https://app.test"))).status, 403);
    assert.equal((await api.mutate(new Request("https://app.test", { method: "POST" }), roomId)).status, 403);
    assert.equal((await api.upload(new Request("https://app.test", { method: "POST" }), roomId)).status, 403);
    assert.equal((await api.file(new Request("https://app.test"), roomId)).status, 403);
    assert.equal(calls.length, 0);
  }
});
test("PDF responses are private and distinguish published URLs from management URLs", async () => {
  const { api, calls } = handlers();
  const response = await api.file(new Request(`https://app.test/file?fileId=${roomId}&download=1`), roomId, true);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.match(response.headers.get("content-disposition")!, /^attachment;.*UTF-8''%/);
  assert.equal(calls[0][3], true);
});
test("upload reads a bounded PDF body and refuses missing versions and unsupported types", async () => {
  for (const headers of [
    { "content-type": "application/pdf", "x-file-name": "room.pdf" },
    { "content-type": "image/png", "x-file-name": "room.pdf", "x-passport-version": "2" },
    { "content-type": "application/pdf", "x-file-name": "room.pdf", "x-passport-version": "NaN" },
  ]) {
    const { api, calls } = handlers();
    assert.ok((await api.upload(new Request("https://app.test", { method: "POST", headers, body: "file" }), roomId)).status >= 400);
    assert.equal(calls.length, 0);
  }
  const { api, calls } = handlers();
  const tooLarge = await api.upload(new Request("https://app.test", { method: "POST", headers: { "content-type": "application/pdf", "x-file-name": "room.pdf", "x-passport-version": "2", "content-length": String(MAX_PASSPORT_BYTES + 1) }, body: "x" }), roomId);
  assert.equal(tooLarge.status, 413); assert.equal(calls.length, 0);
  const conflict = await api.upload(new Request("https://app.test", { method: "POST", headers: { "content-type": "application/pdf", "x-file-name": encodeURIComponent("паспорт.pdf"), "x-passport-version": "2" }, body: "%PDF-test" }), roomId);
  assert.equal(conflict.status, 409);
  assert.deepEqual(calls[0][1], { action: "upload", version: 2 });
  assert.equal((calls[0][3] as { name: string }).name, "паспорт.pdf");
});
test("mutation schema rejects invalid versions, unknown actions and extra fields", async () => {
  const { api, calls } = handlers();
  for (const value of [{ action: "start", version: -1 }, { action: "upload", version: 1 }, { action: "start", version: 0, hidden: true }, { action: "reject", version: 1, reason: "bad" }]) {
    assert.equal((await api.mutate(new Request("https://app.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }), roomId)).status, 400);
  }
  assert.equal(calls.length, 0);
});

test("upload enforces the actual body limit without trusting Content-Length", async () => {
  const headers = { "content-type": "application/pdf", "x-file-name": "room.pdf", "x-passport-version": "2" };
  const boundary = handlers();
  const response = await boundary.api.upload(new Request("https://app.test", { method: "POST", headers, body: new Uint8Array(MAX_PASSPORT_BYTES) }), roomId);
  assert.equal(response.status, 409, "inclusive boundary reaches the service");
  assert.equal((boundary.calls[0][3] as { bytes: Uint8Array }).bytes.byteLength, MAX_PASSPORT_BYTES);
  for (const declaredLength of [undefined, "1"]) {
    const oversized = handlers();
    const response = await oversized.api.upload(new Request("https://app.test", { method: "POST", headers: { ...headers, ...(declaredLength ? { "content-length": declaredLength } : {}) }, body: new Uint8Array(MAX_PASSPORT_BYTES + 1) }), roomId);
    assert.equal(response.status, 413);
    assert.equal(oversized.calls.length, 0);
  }
});
