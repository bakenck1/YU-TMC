import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";
import { exportInventoryItems, activeInventoryItems } from "../lib/server/excel/inventory-excel";
import { filterInventoryItems, inventoryStatusOptions } from "../lib/inventory-list";
import type { InventoryItem } from "../lib/types";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import type { InventoryResponsibilityRepository, TransferRecord } from "../lib/application/ports/inventory-responsibility-repositories";
import type { InventoryItemRecord, InventoryItemRepository, InventoryItemRepositories } from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { INVENTORY_ITEM_CATEGORIES } from "../lib/inventory-categories";
import type { UserRole } from "../lib/contracts/users";

const ITEM = "10000000-0000-4000-8000-000000000001";
const ROOM = "10000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000003";
function fixture(overrides: Partial<InventoryItemRecord> = {}): InventoryItemRecord {
  return { id: ITEM, name: "Cable", description: "keep description", itemType: "components", brand: "Brand", model: "Model", quantity: 2, unitPrice: 10, roomId: ROOM, roomDesignation: "101", floorNumber: 1, buildingId: ROOM, buildingName: "Main", inventoryNumberKind: "official", inventoryNumber: "INV-1", status: "active", qrCode: "YUQ1:keep", responsibleId: OWNER, responsibleName: "Owner", photoUrl: null, version: 1, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), archivedAt: null, ...overrides };
}
function harness(record = fixture()) {
  let current = record;
  const writes: Array<Record<string, unknown>> = [];
  const repository = {
    findItemById: async () => current,
    roomExists: async () => true,
    insertItem: async (value: Record<string, unknown>) => { writes.push(value); current = { ...current, ...value } as InventoryItemRecord; return current; },
    insertItemQr: async () => undefined,
    appendAudit: async () => undefined,
    updateItemCategory: async (value: Record<string, unknown>) => { writes.push(value); current = { ...current, itemType: value.category, version: current.version + 1 } as InventoryItemRecord; return current; },
    updateItemLocation: async (value: Record<string, unknown>) => { writes.push(value); current = { ...current, roomId: value.roomId, version: current.version + 1 } as InventoryItemRecord; return current; },
    updateItemStatus: async (value: Record<string, unknown>) => { writes.push(value); current = { ...current, status: value.status, version: current.version + 1 } as InventoryItemRecord; return current; },
    updateItemProtected: async (value: Record<string, unknown>) => { writes.push(value); current = { ...current, ...value, version: current.version + 1 } as InventoryItemRecord; return current; },
    updateItemContent: async (value: Record<string, unknown>) => { writes.push(value); current = { ...current, ...value, version: current.version + 1 } as InventoryItemRecord; return current; },
  } as unknown as InventoryItemRepository;
  const repositories = { items: repository } satisfies InventoryItemRepositories;
  const uow: UnitOfWork<InventoryItemRepositories> = { read: async work => work(repositories), transaction: async work => work(repositories) };
  let serial = 10;
  const service = new InventoryItemService(uow, { now: () => new Date("2026-10-04") }, { create: () => "10000000-0000-4000-8000-" + String(++serial).padStart(12, "0") }, { create: () => new Uint8Array(16) }, { next: () => "TEMP-ATTACK" });
  return { service, writes, current: () => current };
}

test("attack: category selection has exactly the five agreed values in order", () => {
  assert.deepEqual(INVENTORY_ITEM_CATEGORIES, ["electronics", "electrical_equipment", "furniture", "household_inventory", "components"]);
});
for (const number of ["", "   ", "INV-COMP-1"]) {
  test("attack: component create accepts explicit inventory number " + JSON.stringify(number), async () => {
    const h = harness();
    await h.service.createItem({ name: "Cable", category: "components", roomId: ROOM, inventoryNumber: number }, { userId: ITEM, role: "admin" });
    assert.equal(h.writes[0]?.inventoryNumber, number.trim());
  });
}
test("attack: empty component inventory number survives protected edit", async () => {
  const h = harness(fixture({ inventoryNumber: "" }));
  await h.service.updateProtected(ITEM, { version: 1, roomId: ROOM, inventoryNumber: "", status: "active" }, { userId: ITEM, role: "admin" });
  assert.equal(h.current().inventoryNumber, "");
});
test("attack: setting broken changes only status and keeps assigned owner", async () => {
  const before = fixture();
  const h = harness(before);
  await h.service.updateProtected(ITEM, { version: 1, roomId: ROOM, inventoryNumber: before.inventoryNumber, status: "broken" as never }, { userId: ITEM, role: "admin" });
  assert.equal(h.current().status, "broken");
  for (const key of ["inventoryNumber", "responsibleId", "roomId", "name", "description", "brand", "model", "quantity", "unitPrice", "qrCode"] as const) assert.equal(h.current()[key], before[key], key);
});
for (const role of ["employee", "typography"] as const satisfies readonly UserRole[]) {
  test("attack: direct server call cannot restore broken as " + role, async () => {
    const h = harness(fixture({ status: "broken" as never }));
    await assert.rejects(h.service.updateProtected(ITEM, { version: 1, roomId: ROOM, inventoryNumber: "INV-1", status: "active" }, { userId: OWNER, role }), /forbidden/);
    assert.equal(h.writes.length, 0);
  });
}
test("attack: editing content without category retains old free-form category", async () => {
  const h = harness(fixture({ itemType: "Старое лабораторное оборудование" }));
  const result = await h.service.updateContent(ITEM, { version: 1, name: "Edited", description: "keep description" }, { userId: ITEM, role: "warehouse" });
  assert.equal(h.current().itemType, "Старое лабораторное оборудование");
  assert.equal(result.itemType, "Старое лабораторное оборудование");
  assert.notEqual(result.category, "electronics", "DTO must not relabel an unknown legacy category as electronics");
});
for (const category of ["other", "Оборудование", "tools", ""]) {
  test("attack: arbitrary new category is rejected at service boundary: " + JSON.stringify(category), async () => {
    const h = harness();
    await assert.rejects(h.service.bulkChangeCategory([ITEM], category, { userId: ITEM, role: "admin" }), /invalid_item_category/);
    assert.equal(h.writes.length, 0);
  });
}

for (const role of ["admin", "warehouse"] as const) {
  test("attack: narrow status restore succeeds for " + role + " without losing data or requiring repair comment", async () => {
    const before = fixture({ status: "broken" as never, inventoryNumber: "" });
    const h = harness(before);
    await h.service.changeStatus(ITEM, { version: 1, status: "active" }, { userId: ITEM, role });
    assert.equal(h.current().status, "active");
    for (const key of ["inventoryNumber", "responsibleId", "roomId", "name", "description", "brand", "model", "quantity", "unitPrice", "qrCode"] as const) assert.equal(h.current()[key], before[key], key);
  });
}
for (const role of ["employee", "typography"] as const) {
  test("attack: narrow status restore denies direct service call by " + role, async () => {
    const h = harness(fixture({ status: "broken" as never }));
    await assert.rejects(h.service.changeStatus(ITEM, { version: 1, status: "active" }, { userId: OWNER, role }), /forbidden/);
    assert.equal(h.writes.length, 0);
  });
}
test("attack: stale repair request cannot overwrite newer item revision", async () => {
  const h = harness(fixture({ status: "broken" as never, version: 2 }));
  await assert.rejects(h.service.changeStatus(ITEM, { version: 1, status: "active" }, { userId: ITEM, role: "warehouse" }), /version/);
  assert.equal(h.writes.length, 0);
});
test("attack: empty component cannot be moved to mandatory-number category through content API", async () => {
  const h = harness(fixture({ inventoryNumber: "" }));
  await assert.rejects(h.service.updateContent(ITEM, { version: 1, name: "Cable", category: "electronics" }, { userId: ITEM, role: "warehouse" }), /inventory_number/);
  assert.equal(h.writes.length, 0);
});
test("attack: blank component create with omitted number stores empty rather than temporary official substitute", async () => {
  const h = harness();
  await h.service.createItem({ name: "Cable", category: "components", roomId: ROOM }, { userId: ITEM, role: "admin" });
  assert.equal(h.writes[0]?.inventoryNumber, "");
});

test("attack: status-only repair preserves absent optional condition, connection and project values", async () => {
  const before = fixture({ status: "broken" as never, condition: undefined, connectionStatus: undefined, isProject: undefined });
  const h = harness(before);
  await h.service.changeStatus(ITEM, { version: 1, status: "active" }, { userId: ITEM, role: "admin" });
  for (const key of ["condition", "connectionStatus", "isProject"] as const) assert.equal(h.current()[key], before[key], key + " must not be defaulted during status mutation");
});

test("attack: bulk category bypass cannot leave a numbered-required category with empty number", async () => {
  const h = harness(fixture({ inventoryNumber: "" }));
  await assert.rejects(h.service.bulkChangeCategory([ITEM], "electronics", { userId: ITEM, role: "admin" }), /inventory_number/);
  assert.equal(h.writes.length, 0);
});
for (const role of ["admin", "warehouse", "employee"] as const) {
  test("attack: broken free item remains eligible for normal responsibility acceptance by " + role, async () => {
    let assigned: string | null = null;
    const repository: Partial<InventoryResponsibilityRepository> = {
      findItemState: async () => ({ itemId: ITEM, responsibilityPeriodId: assigned ? "period" : null, responsibleUserId: assigned, responsibleName: assigned, itemStatus: "broken" as never }),
      insertResponsibility: async value => { assigned = value.responsibleUserId; },
      appendAudit: async () => undefined,
    };
    const repos = { responsibility: repository as InventoryResponsibilityRepository };
    const uow = { read: async (work: (v: typeof repos) => Promise<unknown>) => work(repos), transaction: async (work: (v: typeof repos) => Promise<unknown>) => work(repos) } as UnitOfWork<typeof repos>;
    const service = new InventoryResponsibilityService(uow, { now: () => new Date("2026-10-04") }, { create: () => ITEM });
    await service.acceptFree(ITEM, { userId: OWNER, role });
    assert.equal(assigned, OWNER);
  });
}

test("attack: broken assigned item remains eligible for ordinary transfer request", async () => {
  let inserted = false;
  const repository: Partial<InventoryResponsibilityRepository> = {
    findItemState: async () => ({ itemId: ITEM, responsibilityPeriodId: "period", responsibleUserId: ITEM, responsibleName: "Old owner", itemStatus: "broken" as never }),
    findPendingTransfer: async () => null,
    insertTransfer: async value => { inserted = true; return { ...value, requestedByName: "Requester", currentResponsibleName: "Old owner", status: "pending_current_owner", closedAt: null, decisionComment: null, version: 1 } as TransferRecord; },
    appendAudit: async () => undefined,
  };
  const repos = { responsibility: repository as InventoryResponsibilityRepository };
  const uow = { read: async (work: (v: typeof repos) => Promise<unknown>) => work(repos), transaction: async (work: (v: typeof repos) => Promise<unknown>) => work(repos) } as UnitOfWork<typeof repos>;
  const service = new InventoryResponsibilityService(uow, { now: () => new Date("2026-10-04") }, { create: () => ITEM });
  await service.requestTransfer({ itemId: ITEM }, { userId: OWNER, role: "employee" });
  assert.equal(inserted, true);
});
test("attack: too long filled component number still fails established validation", async () => {
  const h = harness();
  await assert.rejects(h.service.createItem({ name: "Cable", category: "components", roomId: ROOM, inventoryNumber: "X".repeat(65) }, { userId: ITEM, role: "admin" }), /invalid_inventory_number/);
  assert.equal(h.writes.length, 0);
});
test("attack: invalid status cannot reach persistence through narrow API", async () => {
  const h = harness();
  await assert.rejects(h.service.changeStatus(ITEM, { version: 1, status: "not-a-status" as never }, { userId: ITEM, role: "admin" }), /invalid_item_status/);
  assert.equal(h.writes.length, 0);
});

test("attack: broken item remains eligible for normal bulk location move", async () => {
  const h = harness(fixture({ status: "broken" as never }));
  const result = await h.service.bulkChangeLocation({ itemSection: "general", roomId: OWNER, items: [{ itemId: ITEM, itemVersion: 1 }] }, { userId: ITEM, role: "admin" });
  assert.equal(result.succeeded, 1);
  assert.equal(h.current().roomId, OWNER);
  assert.equal(h.current().status, "broken");
});

test("attack: direct service create cannot smuggle arbitrary lifecycle status", async () => {
  const h = harness();
  await assert.rejects(h.service.createItem({ name: "Cable", category: "components", roomId: ROOM, status: "invalid-status" as never }, { userId: ITEM, role: "admin" }), /invalid_item_status/);
  assert.equal(h.writes.length, 0);
});
test("attack: broken item remains in ordinary inventory filter and active accounting export", async () => {
  const h = harness(fixture({ status: "broken" as never, inventoryNumber: "" }));
  const dto = await h.service.findItem(ITEM, { userId: ITEM, role: "admin" });
  assert.equal(activeInventoryItems([dto]).length, 1);
  const listItem = { id: ITEM, name: "Cable", status: "broken", category: "components", inventoryNumber: "", location: "Main / 101", responsible: "Owner" } as InventoryItem;
  assert.ok(inventoryStatusOptions([listItem]).some(option => option.key === "lifecycle:broken"));
  assert.deepEqual(filterInventoryItems([listItem], { query: "", category: "all", location: "all", statusKey: "lifecycle:broken" }), [listItem]);
  const bytes = await exportInventoryItems([dto], "Inventory");
  const workbook = new Workbook(); await workbook.xlsx.load(bytes as never);
  const sheet = workbook.getWorksheet("Inventory")!;
  const headers = sheet.getRow(1).values as string[];
  assert.equal(sheet.getRow(2).getCell(headers.indexOf("Status")).text, "broken");
  assert.equal(sheet.getRow(2).getCell(headers.indexOf("Inventory number")).text, "");
  assert.equal(sheet.getRow(2).getCell(headers.indexOf("Responsible")).text, "Owner");
});

test("attack: warehouse creation retains explicitly broken lifecycle status", async () => {
  const h = harness();
  const result = await h.service.createItem({ name: "Cable", category: "components", roomId: ROOM, status: "broken" }, { userId: ITEM, role: "warehouse" });
  assert.equal(h.writes[0]?.status, "broken"); assert.equal(result.status, "broken"); assert.equal(result.inventoryNumber, "");
});

for (const role of ["admin", "warehouse"] as const) {
  for (const status of ["active", "broken", "maintenance", "decommissioned", "decommissioned_in_use"] as const) {
    test(`creation persists selected status ${status} for ${role}`, async () => {
      const h = harness();
      const result = await h.service.createItem({ name: "Cable", category: "components", roomId: ROOM, status }, { userId: ITEM, role });
      assert.equal(h.writes[0]?.status, status);
      assert.equal(result.status, status);
    });
  }
}
