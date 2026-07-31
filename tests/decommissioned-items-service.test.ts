import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { toDecommissionedInventoryItemView } from "../lib/inventory-item-view";
import { canAccessPath } from "../lib/security/authorization";

const DECOMMISSIONED_ITEM: InventoryItemRecord = {
  id: "item-1",
  name: "Projector",
  description: null,
  itemType: "Projector",
  brand: "Epson",
  model: "EB-X49",
  quantity: 1,
  unitPrice: 100,
  roomId: "room-1",
  roomDesignation: "301",
  floorNumber: 3,
  buildingId: "building-1",
  buildingName: "Main",
  inventoryNumberKind: "official",
  inventoryNumber: "INV-42",
  status: "decommissioned",
  qrCode: null,
  responsibleId: "employee-1",
  responsibleName: "Employee",
  photoUrl: null,
  version: 2,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-15T10:30:00.000Z"),
  archivedAt: new Date("2026-07-14T09:00:00.000Z"),
};

function createService(
  itemMethods: Partial<InventoryItemRepository>,
): InventoryItemService {
  const repositories = {
    items: itemMethods as InventoryItemRepository,
  } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date() },
    { create: () => "id" },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );
}

test("lists all decommissioned items for an administrator and exposes archive time", async () => {
  let called = false;
  const service = createService({
    listDecommissionedItems: async () => {
      called = true;
      return [DECOMMISSIONED_ITEM];
    },
  });

  const result = await service.listDecommissionedItems({
    userId: "admin-1",
    role: "admin",
  });

  assert.equal(called, true);
  assert.equal(result[0]?.archivedAt, "2026-07-14T09:00:00.000Z");
  const view = toDecommissionedInventoryItemView(result[0]!);
  const localArchiveDate = new Date(result[0]!.archivedAt!);
  assert.equal(
    view.decommissionedOn,
    [
      localArchiveDate.getFullYear(),
      String(localArchiveDate.getMonth() + 1).padStart(2, "0"),
      String(localArchiveDate.getDate()).padStart(2, "0"),
    ].join("-"),
  );
});

test("uses the assigned archive query for an employee", async () => {
  let requestedUserId = "";
  const service = createService({
    listDecommissionedItemsAssignedTo: async (userId) => {
      requestedUserId = userId;
      return [DECOMMISSIONED_ITEM];
    },
  });

  const result = await service.listDecommissionedItems({
    userId: "employee-1",
    role: "employee",
  });

  assert.equal(requestedUserId, "employee-1");
  assert.equal(result.length, 1);
});

test("archive route is only visible to roles that can read inventory items", () => {
  assert.equal(canAccessPath("admin", "/items/decommissioned"), true);
  assert.equal(canAccessPath("warehouse", "/items/decommissioned"), true);
  assert.equal(canAccessPath("employee", "/items/decommissioned"), true);
  assert.equal(canAccessPath("owner", "/items/decommissioned"), false);
});
