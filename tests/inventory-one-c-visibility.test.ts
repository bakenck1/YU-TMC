import assert from "node:assert/strict";
import test from "node:test";
import type { InventoryItemRecord, InventoryItemRepositories, InventoryItemRepository } from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { inventoryOneCFields } from "../lib/inventory-one-c-visibility";

const itemId = "11111111-1111-4111-8111-111111111111";
const storedCode = "00003254";
function record(overrides: Partial<InventoryItemRecord> = {}): InventoryItemRecord {
  return {
    id: itemId, name: "Monitor", description: null, itemType: "electronics", itemSection: "general", brand: null, model: null,
    oneCCode: storedCode, searchIdentifiers: [storedCode, "LINKED-CODE-99", "241100388", "2411/00388"],
    searchIdentifiersWithoutCodes: ["241100388", "2411/00388"],
    quantity: 1, unitPrice: 100, roomId: "22222222-2222-4222-8222-222222222222", roomDesignation: "101", floorNumber: 1,
    buildingId: "33333333-3333-4333-8333-333333333333", buildingName: "Main", inventoryNumberKind: "official", inventoryNumber: "2411/00388",
    status: "active", qrCode: "QR-1", responsibleId: "employee-1", responsibleName: "Employee", photoUrl: null,
    version: 7, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), archivedAt: null,
    ...overrides,
  };
}
function service(methods: Partial<InventoryItemRepository>) {
  const repositories = { items: methods as InventoryItemRepository } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories), transaction: async (work) => work(repositories),
  };
  return new InventoryItemService(unitOfWork, { now: () => new Date("2026-10-05T00:00:00Z") }, { create: () => "audit-id" }, { create: () => new Uint8Array(16) }, { next: () => "TMP-1" });
}
function assertPrivate(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("oneCCode"), false, serialized);
  assert.equal(serialized.includes(storedCode), false, serialized);
  assert.equal(serialized.includes("LINKED-CODE-99"), false, serialized);
}

test("a warehouse collection excludes codes and retains independently typed inventory and barcode aliases", async () => {
  const inventory = await service({ listItems: async () => [record()] }).listItems({ userId: "warehouse-1", role: "warehouse" });
  assertPrivate(inventory);
  assert.deepEqual(inventory[0].searchIdentifiers, ["241100388", "2411/00388"]);
  assert.equal(inventory[0].name, "Monitor");
});

test("admin collections preserve the code including leading zeroes and all search aliases", async () => {
  const inventory = await service({ listItems: async () => [record()] }).listItems({ userId: "admin-1", role: "admin" });
  assert.equal(inventory[0].oneCCode, storedCode);
  assert.deepEqual(inventory[0].searchIdentifiers, record().searchIdentifiers);
});

test("employee personal collection and direct detail cannot disclose the code", async () => {
  const items = service({ listItemsAssignedTo: async () => [record()], findItemById: async () => record() });
  const actor = { userId: "employee-1", role: "employee" } as const;
  assertPrivate(await items.listOwnItems(actor));
  assertPrivate(await items.listItems(actor));
  assertPrivate(await items.findItem(itemId, actor));
});

test("decommissioned collection uses the same private projection", async () => {
  const items = service({ listDecommissionedItems: async () => [record({ status: "decommissioned" })] });
  assertPrivate(await items.listDecommissionedItems({ userId: "warehouse-1", role: "warehouse" }));
});

test("readable component details cannot bypass the actor's projection", async () => {
  const items = service({ findItemById: async () => record(), listComponents: async () => [record()] });
  assertPrivate(await items.listComponents(itemId, { userId: "employee-1", role: "employee" }));
});

test("missing public alias metadata never falls back to mixed private search identifiers", () => {
  const source = { oneCCode: storedCode, searchIdentifiers: [storedCode, "LINKED-CODE-99", "241100388"] };
  assert.deepEqual(inventoryOneCFields(source, "warehouse"), { searchIdentifiers: [] });
  assert.deepEqual(inventoryOneCFields(source, "typography"), { searchIdentifiers: [] });
  assert.deepEqual(inventoryOneCFields(source, "unknown"), { searchIdentifiers: [] });
  assert.deepEqual(source.searchIdentifiers, [storedCode, "LINKED-CODE-99", "241100388"]);
});

test("warehouse cannot add or clear a code through crafted content requests", async () => {
  const items = service({ findItemById: async () => { throw new Error("must be rejected before reading private data"); } });
  for (const oneCCode of ["00009999", null]) {
    await assert.rejects(items.updateContent(itemId, { version: 7, name: "New", description: null, oneCCode }, { userId: "warehouse-1", role: "warehouse" }), { kind: "forbidden" });
  }
});

test("warehouse edits retain the hidden code even when category changes, and the mutation response excludes it", async () => {
  let persistedCode: string | null | undefined;
  const items = service({
    findItemById: async () => record(),
    updateItemContent: async (input) => {
      persistedCode = input.oneCCode;
      return record({ ...input, version: 8 });
    },
    appendAudit: async () => undefined,
  });
  const updated = await items.updateContent(itemId, { version: 7, name: "New monitor", description: null, category: "components" }, { userId: "warehouse-1", role: "warehouse" });
  assert.equal(persistedCode, storedCode);
  assertPrivate(updated);
  assert.equal(updated.name, "New monitor");
});

test("status mutation responses also hide stored codes", async () => {
  const items = service({ findItemById: async () => record({ status: "broken" }), updateItemStatus: async () => record({ status: "active", version: 8 }), appendAudit: async () => undefined });
  assertPrivate(await items.changeStatus(itemId, { version: 7, status: "active" }, { userId: "warehouse-1", role: "warehouse" }));
});
