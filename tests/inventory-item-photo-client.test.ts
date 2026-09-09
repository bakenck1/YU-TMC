import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryItemDto } from "../lib/contracts/inventory-items";
import { addItemPhotoWithRefresh } from "../lib/inventory-item-photo-client";

const ITEM: InventoryItemDto = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Monitor",
  description: null,
  itemType: "Equipment",
  brand: null,
  model: null,
  quantity: 1,
  unitPrice: 1,
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
  photoUrls: [],
  version: 3,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  archivedAt: null,
};

const PHOTO = {
  imageDataUrl: "data:image/jpeg;base64,/9j/",
  width: 1,
  height: 1,
};

test("refreshes a stale item and retries adding its photo once", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const freshItem = { ...ITEM, version: 8 };
  const savedItem = {
    ...freshItem,
    photoUrl: `/api/inventory/items/${ITEM.id}/photo?photoId=photo-1`,
    photoUrls: [`/api/inventory/items/${ITEM.id}/photo?photoId=photo-1`],
    version: 9,
  };
  const responses = [
    Response.json({ error: "version_conflict" }, { status: 409 }),
    Response.json({ item: freshItem }),
    Response.json({ item: savedItem }),
  ];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  const result = await addItemPhotoWithRefresh(fetcher, ITEM, PHOTO);

  assert.deepEqual(result, savedItem);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)).version, 3);
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)).version, 8);
});

test("does not upload a fifth photo after refreshing a stale item", async () => {
  const fullItem = {
    ...ITEM,
    version: 8,
    photoUrl: "/photo/1",
    photoUrls: ["/photo/1", "/photo/2", "/photo/3", "/photo/4"],
  };
  const responses = [
    Response.json({ error: "version_conflict" }, { status: 409 }),
    Response.json({ item: fullItem }),
  ];
  const fetcher = (async () => {
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  await assert.rejects(
    addItemPhotoWithRefresh(fetcher, ITEM, PHOTO),
    /photo_limit_reached/,
  );
  assert.equal(responses.length, 0);
});
