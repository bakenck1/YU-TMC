import assert from "node:assert/strict";
import test from "node:test";

import { createTmcBulkLocationPostHandler } from "../lib/server/http/tmc-bulk-location-handler";

const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "admin" as const,
};
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("bulk-location route forwards strict command data with server identity", async () => {
  const calls: unknown[][] = [];
  const result = {
    total: 1,
    succeeded: 1,
    problems: 0,
    items: [{ itemId: ITEM_ID, outcome: "success" as const, itemVersion: 4 }],
  };
  const handler = createTmcBulkLocationPostHandler({
    authenticate: async () => ACTOR,
    changeLocation: async (...arguments_) => {
      calls.push(arguments_);
      return result;
    },
  });
  const response = await handler(jsonRequest({
    roomId: ROOM_ID,
    comment: "  Relocation  ",
    items: [{ itemId: ITEM_ID, itemVersion: 3 }],
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result });
  assert.deepEqual(calls, [[{
    roomId: ROOM_ID,
    comment: "  Relocation  ",
    items: [{ itemId: ITEM_ID, itemVersion: 3 }],
  }, ACTOR]]);
});

test("bulk-location route rejects identity injection and oversized selections", async () => {
  let calls = 0;
  const handler = createTmcBulkLocationPostHandler({
    authenticate: async () => ACTOR,
    changeLocation: async () => {
      calls += 1;
      throw new Error("must_not_run");
    },
  });
  const injected = await handler(jsonRequest({
    roomId: ROOM_ID,
    actorId: ACTOR.userId,
    items: [{ itemId: ITEM_ID, itemVersion: 3 }],
  }));
  assert.equal(injected.status, 400);
  assert.deepEqual(await injected.json(), { error: "invalid_request" });

  const oversized = await handler(jsonRequest({
    roomId: ROOM_ID,
    items: Array.from({ length: 51 }, (_, index) => ({
      itemId: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
      itemVersion: 1,
    })),
  }));
  assert.equal(oversized.status, 400);
  assert.deepEqual(await oversized.json(), { error: "invalid_request" });
  assert.equal(calls, 0);
});

test("bulk-location route rejects an oversized streamed body before command execution", async () => {
  let calls = 0;
  const handler = createTmcBulkLocationPostHandler({
    authenticate: async () => ACTOR,
    changeLocation: async () => {
      calls += 1;
      throw new Error("must_not_run");
    },
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(17 * 1024));
      controller.close();
    },
  });
  const request = new Request(
    "https://inventory.example/api/inventory/items/bulk-location",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  const response = await handler(request);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "payload_too_large" });
  assert.equal(calls, 0);
});

function jsonRequest(value: unknown) {
  return new Request("https://inventory.example/api/inventory/items/bulk-location", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
