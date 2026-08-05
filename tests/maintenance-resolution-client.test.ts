import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryItemDto } from "../lib/contracts/inventory-items";
import { resolveMaintenanceItemWithRefresh } from "../lib/maintenance-resolution-client";

const MAINTENANCE_ITEM: InventoryItemDto = {
  id: "item-1",
  name: "Projector",
  description: null,
  itemType: "Equipment",
  brand: null,
  model: null,
  quantity: 1,
  unitPrice: 100,
  inventoryNumberKind: "official",
  inventoryNumber: "INV-1",
  room: {
    id: "room-1",
    designation: "101",
    floorNumber: 1,
    buildingId: "building-1",
    buildingName: "Main",
  },
  status: "maintenance",
  qrCode: "QR-1",
  responsible: null,
  photoUrl: null,
  version: 4,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  maintenanceStartedAt: "2026-08-02T00:00:00.000Z",
  archivedAt: null,
};

test("refreshes a stale maintenance item and retries the resolution once", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const freshItem = { ...MAINTENANCE_ITEM, version: 7 };
  const resolvedItem = { ...freshItem, status: "active" as const, version: 8 };
  const responses = [
    Response.json({ error: "version_conflict" }, { status: 409 }),
    Response.json({ item: freshItem }),
    Response.json({ item: resolvedItem }),
  ];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  const result = await resolveMaintenanceItemWithRefresh(
    fetcher,
    MAINTENANCE_ITEM,
    "active",
  );

  assert.deepEqual(result, resolvedItem);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.init?.method, "PATCH");
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), {
    operation: "resolve_maintenance",
    version: 7,
    status: "active",
  });
});

test("does not retry when another request has already resolved the item", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const alreadyResolved = {
    ...MAINTENANCE_ITEM,
    status: "decommissioned" as const,
    version: 5,
  };
  const responses = [
    Response.json({ error: "version_conflict" }, { status: 409 }),
    Response.json({ item: alreadyResolved }),
  ];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;

  const result = await resolveMaintenanceItemWithRefresh(
    fetcher,
    MAINTENANCE_ITEM,
    "decommissioned",
  );

  assert.deepEqual(result, alreadyResolved);
  assert.equal(calls.length, 2);
});
