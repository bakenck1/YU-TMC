import assert from "node:assert/strict";
import test from "node:test";

import type {
  InsertInventoryItemRecord,
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { legacyItemDetailVisibility } from "../lib/item-detail-visibility";
import { canAccessPath } from "../lib/security/authorization";
import { hasPermission } from "../lib/security/permissions";

function createItemService(items: InventoryItemRepository = {} as InventoryItemRepository) {
  const repositories = {
    items,
  } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-08-03T00:00:00.000Z") },
    { create: () => "id" },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );
}

test("warehouse creation is server-limited to basic item fields", async () => {
  let inserted: InsertInventoryItemRecord | null = null;
  const items = {
    roomExists: async () => true,
    insertItem: async (input: InsertInventoryItemRecord) => {
      inserted = input;
      return {
        ...input,
        roomDesignation: "101",
        floorNumber: 1,
        buildingId: "22222222-2222-4222-8222-222222222222",
        buildingName: "Main",
        status: "active",
        qrCode: null,
        responsibleId: null,
        responsibleName: null,
        photoUrl: null,
        version: 1,
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
        archivedAt: null,
      } satisfies InventoryItemRecord;
    },
    insertItemQr: async () => undefined,
    appendAudit: async () => undefined,
  } as unknown as InventoryItemRepository;
  const service = createItemService(items);
  const actor = { userId: "warehouse-1", role: "warehouse" as const };
  const basicInput = {
    name: "New item",
    description: "Recorded during intake",
    roomId: "11111111-1111-4111-8111-111111111111",
    itemType: null,
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 0,
    barcode: null,
  };

  await service.createItem(basicInput, actor);

  assert.equal(inserted?.name, basicInput.name);
  assert.equal(inserted?.description, basicInput.description);
  assert.equal(inserted?.quantity, 1);
  assert.equal(inserted?.unitPrice, 0);
  assert.equal(inserted?.brand, null);
  assert.equal(inserted?.model, null);

  await assert.rejects(
    service.createItem({ ...basicInput, unitPrice: 100 }, actor),
    /forbidden/,
  );
  await assert.rejects(
    service.createItem({ ...basicInput, barcode: "INV-100" }, actor),
    /forbidden/,
  );
});

test("warehouse can create restricted items but cannot access other mutations or inspections", () => {
  const warehouse = "warehouse" as const;

  assert.equal(hasPermission(warehouse, "inventory.item.read_all"), true);
  assert.equal(hasPermission(warehouse, "inventory.report.export"), true);
  assert.equal(canAccessPath(warehouse, "/"), true);
  assert.equal(canAccessPath(warehouse, "/items"), true);
  assert.equal(canAccessPath(warehouse, "/items/decommissioned"), true);
  assert.equal(canAccessPath(warehouse, "/analytics"), true);
  assert.equal(hasPermission(warehouse, "inventory.item.create"), true);
  assert.equal(hasPermission(warehouse, "inventory.item.edit_content"), false);
  assert.equal(
    hasPermission(warehouse, "inventory.item.manage_protected_fields"),
    false,
  );
  assert.equal(hasPermission(warehouse, "inventory.item.send_to_service"), false);
  assert.equal(hasPermission(warehouse, "inventory.item.resolve_maintenance"), false);
  assert.equal(hasPermission(warehouse, "inventory.item.bulk_manage"), false);

  assert.equal(hasPermission(warehouse, "inventory.inspection.create_self"), false);
  assert.equal(hasPermission(warehouse, "inventory.inspection.read_own"), false);
  assert.equal(hasPermission(warehouse, "inventory.inspection.mutate_own_draft"), false);
  assert.equal(hasPermission(warehouse, "inventory.result.record_own_inspection"), false);
  assert.equal(canAccessPath(warehouse, "/inventory/inspections"), false);
  assert.equal(canAccessPath(warehouse, "/inventory"), false);
  assert.equal(canAccessPath(warehouse, "/users"), false);
  assert.equal(canAccessPath(warehouse, "/settings"), false);
});

test("warehouse item mutations other than creation are rejected before repository access", async () => {
  const service = createItemService();
  const actor = { userId: "warehouse-1", role: "warehouse" as const };
  const forbiddenMutations = [
    service.importItems([] as never, actor),
    service.updateContent("item-1", {} as never, actor),
    service.updatePhoto("item-1", {} as never, actor),
    service.updateProtected("item-1", {} as never, actor),
    service.archiveItem("item-1", 1, actor),
    service.sendToService("item-1", 1, {} as never, actor),
    service.resolveMaintenanceItem("item-1", {} as never, actor),
    service.addComponent("item-1", "item-2", actor),
    service.removeComponent("item-1", "item-2", actor),
    service.addComment("item-1", {} as never, actor),
  ];

  for (const mutation of forbiddenMutations) {
    await assert.rejects(mutation, /forbidden/);
  }
});

test("legacy item details expose only read controls without management access", () => {
  assert.deepEqual(legacyItemDetailVisibility(false), {
    tabs: ["info"],
    canGenerateQr: false,
  });
  assert.deepEqual(legacyItemDetailVisibility(true), {
    tabs: ["info", "edit", "service", "writeoff", "delete"],
    canGenerateQr: true,
  });
});
