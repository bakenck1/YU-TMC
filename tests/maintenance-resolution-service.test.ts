import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryItemRecord, InventoryItemRepositories, InventoryItemRepository } from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";

const MAINTENANCE_ITEM: InventoryItemRecord = {
  id: "item-1", name: "Projector", description: null, itemType: "Equipment", brand: null, model: null,
  quantity: 1, unitPrice: 100, roomId: "room-1", roomDesignation: "101", floorNumber: 1,
  buildingId: "building-1", buildingName: "Main", inventoryNumberKind: "official", inventoryNumber: "INV-1",
  status: "maintenance", qrCode: "QR-1", responsibleId: "employee-1", responsibleName: "Employee",
  photoUrl: null, version: 4, createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-02T00:00:00.000Z"), maintenanceStartedAt: new Date("2026-08-02T00:00:00.000Z"),
  archivedAt: null,
};

function createService(itemMethods: Partial<InventoryItemRepository>) {
  const repositories = { items: itemMethods as InventoryItemRepository } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories), transaction: async (work) => work(repositories),
  };
  return new InventoryItemService(
    unitOfWork, { now: () => new Date("2026-08-03T10:00:00.000Z") }, { create: () => "audit-1" },
    { create: () => new Uint8Array(16) }, { next: () => "TMP-1" },
  );
}

test("only an administrator can resolve a maintenance item and the resolution is audited", async () => {
  let resolved: Record<string, unknown> | undefined;
  let audit: Record<string, unknown> | undefined;
  const service = createService({
    findItemById: async () => MAINTENANCE_ITEM,
    resolveMaintenanceItem: async (input) => {
      resolved = input as unknown as Record<string, unknown>;
      return { ...MAINTENANCE_ITEM, status: "decommissioned", version: 5 };
    },
    appendAudit: async (input) => { audit = input as unknown as Record<string, unknown>; },
  });

  const result = await service.resolveMaintenanceItem(
    MAINTENANCE_ITEM.id, { version: 4, status: "decommissioned" }, { userId: "admin-1", role: "admin" },
  );

  assert.equal(result.status, "decommissioned");
  assert.deepEqual(resolved, {
    id: "item-1", status: "decommissioned", actorId: "admin-1", expectedVersion: 4,
    occurredAt: new Date("2026-08-03T10:00:00.000Z"),
  });
  assert.equal(audit?.action, "item.maintenance_resolved");
  assert.deepEqual(audit?.beforeValues, { status: "maintenance" });
  assert.deepEqual(audit?.afterValues, { status: "decommissioned" });

  await assert.rejects(
    service.resolveMaintenanceItem("item-1", { version: 4, status: "active" }, { userId: "warehouse-1", role: "warehouse" }),
    /forbidden/,
  );
});

test("a maintenance resolution cannot change an item that is no longer in service", async () => {
  const service = createService({ findItemById: async () => ({ ...MAINTENANCE_ITEM, status: "active" }) });
  await assert.rejects(
    service.resolveMaintenanceItem("item-1", { version: 4, status: "active" }, { userId: "admin-1", role: "admin" }),
    /item_not_in_maintenance/,
  );
});
