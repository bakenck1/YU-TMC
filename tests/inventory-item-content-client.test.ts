import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryItemDto } from "../lib/contracts/inventory-items";
import { updateItemContentWithRefresh } from "../lib/inventory-item-content-client";

const ITEM: InventoryItemDto = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Monitor",
  description: "Office display",
  category: "electronics",
  itemType: "electronics",
  itemSection: "general",
  brand: null,
  model: "M1",
  quantity: 1,
  unitPrice: 100,
  inventoryNumberKind: "official",
  inventoryNumber: "INV-1",
  room: {
    id: "22222222-2222-4222-8222-222222222222",
    designation: "101",
    floorNumber: 1,
    buildingId: "33333333-3333-4333-8333-333333333333",
    buildingName: "Main",
  },
  status: "active",
  qrCode: null,
  responsible: null,
  photoUrl: null,
  version: 3,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  archivedAt: null,
};

test("refreshes stale content and preserves unrelated concurrent changes", async () => {
  const latestItem = {
    ...ITEM,
    brand: "Dell",
    unitPrice: 125,
    version: 8,
  };
  const savedItem = {
    ...latestItem,
    name: "Updated monitor",
    version: 9,
  };
  const responses = [
    Response.json({ error: "version_conflict" }, { status: 409 }),
    Response.json({ item: latestItem }),
    Response.json({ item: savedItem }),
  ];
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  const result = await updateItemContentWithRefresh(fetcher, ITEM, {
    name: "Updated monitor",
    description: ITEM.description,
    category: ITEM.category,
    brand: ITEM.brand,
    model: ITEM.model,
    quantity: ITEM.quantity,
    unitPrice: ITEM.unitPrice,
  });

  assert.deepEqual(result, savedItem);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)).version, 3);
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), {
    version: 8,
    name: "Updated monitor",
    description: "Office display",
    category: "electronics",
    brand: "Dell",
    model: "M1",
    quantity: 1,
    unitPrice: 125,
  });
});

test("reports a second conflict instead of retrying indefinitely", async () => {
  const responses = [
    Response.json({ error: "version_conflict" }, { status: 409 }),
    Response.json({ item: { ...ITEM, version: 4 } }),
    Response.json({ error: "version_conflict" }, { status: 409 }),
  ];
  const fetcher = (async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  await assert.rejects(
    updateItemContentWithRefresh(fetcher, ITEM, {
      name: "Updated monitor",
      category: "electronics",
    }),
    /version_conflict/,
  );
  assert.equal(responses.length, 0);
});
