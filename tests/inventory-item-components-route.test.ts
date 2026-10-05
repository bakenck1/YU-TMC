import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../lib/domain/application-error";
import { createInventoryItemComponentsMutationHandler } from "../lib/server/http/inventory-item-components-handler";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const COMPONENT_IDS = [
  "22222222-2222-4222-8222-222222222222",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
];
const ACTOR = { userId: ITEM_ID, role: "admin" } as const;

test("component POST forwards the whole selection with authenticated identity and supports legacy input", async () => {
  const calls: unknown[][] = [];
  const handler = createInventoryItemComponentsMutationHandler({
    authenticate: async () => ACTOR,
    addComponents: async (...arguments_) => { calls.push(arguments_); return []; },
    removeComponent: async () => { throw new Error("must_not_remove"); },
  }, "add");

  for (const input of [{ componentIds: COMPONENT_IDS }, { componentId: COMPONENT_IDS[0] }]) {
    const response = await handler(jsonRequest(input), ITEM_ID);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { components: [] });
  }
  assert.deepEqual(calls, [[ITEM_ID, COMPONENT_IDS, ACTOR], [ITEM_ID, [COMPONENT_IDS[0]], ACTOR]]);
});

test("component POST rejects empty, malformed, mixed-type and invalid UUID batches without mutation", async () => {
  let mutations = 0;
  const handler = createInventoryItemComponentsMutationHandler({
    authenticate: async () => ACTOR,
    addComponents: async () => { mutations += 1; return []; },
    removeComponent: async () => { throw new Error("must_not_remove"); },
  }, "add");
  for (const input of [null, [], {}, { componentIds: [] }, { componentIds: "wrong" },
    { componentIds: [COMPONENT_IDS[0], null] }, { componentIds: [123] },
    { componentIds: [COMPONENT_IDS[0], "not-a-uuid"] },
    { componentIds: [], componentId: COMPONENT_IDS[0] }]) {
    assert.equal((await handler(jsonRequest(input), ITEM_ID)).status, 400);
  }
  assert.equal((await handler(jsonRequest({ componentIds: COMPONENT_IDS }), "invalid")).status, 400);
  assert.equal(mutations, 0);
});

test("component DELETE preserves singular input and rejects a batch-only request", async () => {
  const calls: unknown[][] = [];
  const handler = createInventoryItemComponentsMutationHandler({
    authenticate: async () => ACTOR,
    addComponents: async () => { throw new Error("must_not_add"); },
    removeComponent: async (...arguments_) => { calls.push(arguments_); return []; },
  }, "remove");
  assert.equal((await handler(jsonRequest({ componentId: COMPONENT_IDS[0] }), ITEM_ID)).status, 200);
  assert.deepEqual(calls, [[ITEM_ID, COMPONENT_IDS[0], ACTOR]]);
  assert.equal((await handler(jsonRequest({ componentIds: COMPONENT_IDS }), ITEM_ID)).status, 400);
  assert.equal(calls.length, 1);
});

test("component mutation bounds streamed bodies and handles malformed JSON", async () => {
  let mutations = 0;
  const handler = createInventoryItemComponentsMutationHandler({
    authenticate: async () => ACTOR,
    addComponents: async () => { mutations += 1; return []; },
    removeComponent: async () => { throw new Error("must_not_remove"); },
  }, "add");
  const oversized = await handler(jsonRequest({ componentIds: COMPONENT_IDS, padding: "x".repeat(65 * 1024) }), ITEM_ID);
  assert.equal(oversized.status, 413);
  const malformed = await handler(new Request("https://inventory.test/api", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{",
  }), ITEM_ID);
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_request" });
  assert.equal(mutations, 0);
});

test("component mutation preserves domain conflict and permission errors", async () => {
  for (const [kind, code, status] of [["conflict", "item_component_already_exists", 409],
    ["forbidden", "forbidden", 403]] as const) {
    const handler = createInventoryItemComponentsMutationHandler({
      authenticate: async () => ACTOR,
      addComponents: async () => { throw new ApplicationError(kind, code); },
      removeComponent: async () => [],
    }, "add");
    const response = await handler(jsonRequest({ componentIds: COMPONENT_IDS }), ITEM_ID);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});

function jsonRequest(input: unknown) {
  return new Request("https://inventory.test/api", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}
