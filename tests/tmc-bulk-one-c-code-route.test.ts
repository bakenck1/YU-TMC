import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../lib/domain/application-error";
import { createTmcBulkOneCCodePatchHandler } from "../lib/server/http/tmc-bulk-one-c-code-handler";

const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = { userId: ITEM, role: "admin" as const };
const request = (body: unknown) => new Request("https://example.test/api/inventory/items/bulk-one-c-code", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

test("bulk code endpoint forwards selected IDs and string code using the authenticated actor", async () => {
  const calls: unknown[][] = [];
  const result = { updatedItemIds: [ITEM], oneCCode: "000014398" };
  const patch = createTmcBulkOneCCodePatchHandler({
    authenticate: async () => ACTOR,
    changeCode: async (...args) => { calls.push(args); return result; },
  });
  const response = await patch(request({ itemIds: [ITEM], oneCCode: "000014398" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(calls, [[[ITEM], "000014398", ACTOR]]);
});

test("bulk code endpoint rejects identity injection, invalid types, empty and oversized selections", async () => {
  let calls = 0;
  const patch = createTmcBulkOneCCodePatchHandler({
    authenticate: async () => ACTOR,
    changeCode: async () => { calls++; return { updatedItemIds: [], oneCCode: "" }; },
  });
  for (const body of [null, [], {}, { itemIds: [ITEM], oneCCode: 42 },
    { itemIds: [ITEM], oneCCode: "00042", actorId: ITEM },
    { itemIds: [ITEM], oneCCode: "00042", itemSection: "it" },
    { itemIds: [], oneCCode: "00042" }, { itemIds: [123], oneCCode: "00042" },
    { itemIds: Array(2001).fill(ITEM), oneCCode: "00042" }]) {
    assert.equal((await patch(request(body))).status, 400);
  }
  assert.equal(calls, 0);
});

test("bulk code endpoint blocks unauthenticated and non-admin requests", async () => {
  let calls = 0;
  for (const role of ["employee", "warehouse", "typography"] as const) {
    const patch = createTmcBulkOneCCodePatchHandler({
      authenticate: async () => ({ ...ACTOR, role }),
      changeCode: async () => { calls++; return { updatedItemIds: [], oneCCode: "" }; },
    });
    assert.equal((await patch(request({ itemIds: [ITEM], oneCCode: "00042" }))).status, 403);
  }
  const patch = createTmcBulkOneCCodePatchHandler({
    authenticate: async () => { throw new ApplicationError("unauthorized", "unauthorized"); },
    changeCode: async () => { calls++; return { updatedItemIds: [], oneCCode: "" }; },
  });
  assert.equal((await patch(request({ itemIds: [ITEM], oneCCode: "00042" }))).status, 401);
  assert.equal(calls, 0);
});

test("bulk code endpoint returns validation/conflict errors and rejects malformed or oversized bodies", async () => {
  for (const [kind, status] of [["validation", 400], ["conflict", 409]] as const) {
    const patch = createTmcBulkOneCCodePatchHandler({
      authenticate: async () => ACTOR,
      changeCode: async () => { throw new ApplicationError(kind, "save_failed"); },
    });
    const response = await patch(request({ itemIds: [ITEM], oneCCode: "00042" }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "save_failed" });
  }
  const patch = createTmcBulkOneCCodePatchHandler({
    authenticate: async () => ACTOR,
    changeCode: async () => { throw new Error("must_not_run"); },
  });
  assert.equal((await patch(new Request("https://example.test", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: "{",
  }))).status, 400);
  assert.equal((await patch(request({ itemIds: [ITEM], oneCCode: "x".repeat(128 * 1024) }))).status, 413);
});
