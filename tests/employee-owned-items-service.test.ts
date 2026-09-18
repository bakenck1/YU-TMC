import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { toInventoryItemView } from "../lib/inventory-item-view";
import { summarizeInventory } from "../lib/inventory-summary";
import { hasPermission } from "../lib/security/permissions";

function item(
  id: string,
  responsibleId: string,
  status: InventoryItemRecord["status"] = "active",
): InventoryItemRecord {
  return {
    id,
    name: `Item ${id}`,
    description: null,
    itemType: "Equipment",
    brand: null,
    model: null,
    quantity: 2,
    unitPrice: 500,
    roomId: "room-1",
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: "building-1",
    buildingName: "Main",
    inventoryNumberKind: "official",
    inventoryNumber: `INV-${id}`,
    status,
    qrCode: null,
    responsibleId,
    responsibleName: responsibleId,
    photoUrl: null,
    version: 1,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    archivedAt: null,
  };
}

function createService(itemMethods: Partial<InventoryItemRepository>) {
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

test("an employee receives only their assigned items and derived summary", async () => {
  const assigned = [
    item("mine-active", "employee-1"),
    item("mine-maintenance", "employee-1", "maintenance"),
    item("mine-decommissioned", "employee-1", "decommissioned"),
  ];
  let requestedFor: string | undefined;
  const service = createService({
    listItems: async () => {
      throw new Error("employee must not request the global item list");
    },
    listItemsAssignedTo: async (userId) => {
      requestedFor = userId;
      return assigned;
    },
  });

  const items = await service.listItems({ userId: "employee-1", role: "employee" });

  assert.equal(requestedFor, "employee-1");
  assert.deepEqual(items.map((value) => value.id), [
    "mine-active",
    "mine-maintenance",
    "mine-decommissioned",
  ]);
  assert.deepEqual(summarizeInventory(items.map(toInventoryItemView)), {
    totalValue: 3_000,
    totalItems: 6,
    maintenance: 2,
    decommissioned: 1,
  });
});

test("employee collection drops legacy room-primary items without personal assignment", async () => {
  const mine = item("mine", "employee-1");
  const foreign = item("foreign", "employee-2");
  foreign.roomResponsibleId = "employee-1";
  const service = createService({
    listItemsAssignedTo: async () => [mine, foreign],
  });

  const result = await service.listItems({ userId: "employee-1", role: "employee" });
  assert.deepEqual(result.map(({ id }) => id), ["mine"]);
});

test("employees cannot use the global inventory read permission", () => {
  assert.equal(hasPermission("employee", "inventory.item.read_all"), false);
  assert.equal(hasPermission("employee", "inventory.item.read_assigned"), true);
  assert.equal(hasPermission("warehouse", "inventory.item.read_all"), true);
});

test("closed-room direct item access ignores legacy room responsibility", async () => {
  const foreign = item("foreign", "employee-2", "active");
  foreign.roomResponsibleId = "employee-1";
  foreign.roomAccessMode = "closed";
  const guarded = createService({ findItemById: async () => foreign });

  await assert.rejects(
    guarded.findItem("foreign", { userId: "employee-1", role: "employee" }),
    (error: unknown) =>
      error instanceof Error && error.message === "item_not_found",
  );
});

test("open-room direct item access is read-only-visible to an employee", async () => {
  const foreign = item("foreign", "employee-2", "active");
  foreign.roomAccessMode = "open";
  const service = createService({ findItemById: async () => foreign });

  const result = await service.findItem("foreign", {
    userId: "employee-1",
    role: "employee",
  });
  assert.equal(result.id, "foreign");
  assert.equal(result.responsible?.id, "employee-2");
});
