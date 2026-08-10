import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
  UpdateInventoryItemLocationRecord,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { ApplicationError } from "../lib/domain/application-error";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STALE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INACTIVE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("admin bulk location change updates valid rows and reports stale or inactive rows separately", async () => {
  const records = new Map<string, InventoryItemRecord>([
    [ACTIVE_ID, item(ACTIVE_ID, 3, "active")],
    [STALE_ID, item(STALE_ID, 5, "active")],
    [INACTIVE_ID, item(INACTIVE_ID, 2, "decommissioned")],
  ]);
  const updates: UpdateInventoryItemLocationRecord[] = [];
  const audits: Array<{ beforeValues: unknown; afterValues: unknown }> = [];
  const repository = {
    roomExists: async (id: string) => id === ROOM_ID,
    findItemById: async (id: string) => records.get(id) ?? null,
    updateItemLocation: async (input: UpdateInventoryItemLocationRecord) => {
      updates.push(input);
      const current = records.get(input.id);
      if (!current || current.version !== input.expectedVersion) return null;
      const updated = {
        ...current,
        roomId: input.roomId,
        roomDesignation: "204",
        buildingId: "33333333-3333-4333-8333-333333333333",
        buildingName: "Main campus",
        version: current.version + 1,
      };
      records.set(input.id, updated);
      return updated;
    },
    appendAudit: async (input: { beforeValues: unknown; afterValues: unknown }) => {
      audits.push(input);
    },
  } as unknown as InventoryItemRepository;
  const service = createService(repository);

  const result = await service.bulkChangeLocation({
    roomId: ROOM_ID,
    comment: "  Move for inventory check  ",
    items: [
      { itemId: ACTIVE_ID, itemVersion: 3 },
      { itemId: STALE_ID, itemVersion: 4 },
      { itemId: INACTIVE_ID, itemVersion: 2 },
    ],
  }, { userId: ADMIN_ID, role: "admin" });

  assert.deepEqual(result, {
    total: 3,
    succeeded: 1,
    problems: 2,
    items: [
      { itemId: ACTIVE_ID, outcome: "success", itemVersion: 4 },
      { itemId: STALE_ID, outcome: "problem", problem: "version_conflict" },
      { itemId: INACTIVE_ID, outcome: "problem", problem: "item_inactive" },
    ],
  });
  assert.equal(updates.length, 1);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0]?.beforeValues, {
    roomId: "44444444-4444-4444-8444-444444444444",
    location: "Old building / 101",
  });
  assert.deepEqual(audits[0]?.afterValues, {
    roomId: ROOM_ID,
    location: "Main campus / 204",
    comment: "Move for inventory check",
  });
});

test("bulk location change remains admin-only and rejects an unavailable target room", async () => {
  const repository = {
    roomExists: async () => false,
  } as unknown as InventoryItemRepository;
  const service = createService(repository);

  await assert.rejects(
    service.bulkChangeLocation({
      roomId: ROOM_ID,
      items: [{ itemId: ACTIVE_ID, itemVersion: 1 }],
    }, { userId: ADMIN_ID, role: "employee" }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "forbidden" &&
      error.publicCode === "forbidden",
  );
  await assert.rejects(
    service.bulkChangeLocation({
      roomId: ROOM_ID,
      items: [{ itemId: ACTIVE_ID, itemVersion: 1 }],
    }, { userId: ADMIN_ID, role: "admin" }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "not_found" &&
      error.publicCode === "room_not_found",
  );
});

function createService(repository: InventoryItemRepository) {
  const repositories = { items: repository } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  };
  let id = 0;
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-08-10T08:00:00.000Z") },
    { create: () => `90000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
    { create: () => new Uint8Array(16) },
    { next: () => "TMP-2026-TEST" },
  );
}

function item(
  id: string,
  version: number,
  status: InventoryItemRecord["status"],
): InventoryItemRecord {
  return {
    id,
    name: `Item ${id}`,
    description: null,
    itemType: "Equipment",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 100,
    roomId: "44444444-4444-4444-8444-444444444444",
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: "55555555-5555-4555-8555-555555555555",
    buildingName: "Old building",
    inventoryNumberKind: "official",
    inventoryNumber: `INV-${id}`,
    status,
    qrCode: null,
    responsibleId: ADMIN_ID,
    responsibleName: "Administrator",
    photoUrl: null,
    version,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: status === "decommissioned" ? new Date("2026-02-01T00:00:00.000Z") : null,
  };
}
