import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
] as const;

function item(id: string, responsibleId: string | null = null): InventoryItemRecord {
  return {
    id,
    name: id === IDS[0] ? "Комплект" : "Монитор",
    description: null,
    itemType: "Оборудование",
    brand: "Brand",
    model: null,
    quantity: 1,
    unitPrice: 10,
    roomId: IDS[0],
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: IDS[0],
    buildingName: "Корпус",
    inventoryNumberKind: "official",
    inventoryNumber: `INV-${id.slice(0, 4)}`,
    status: "active",
    qrCode: null,
    responsibleId,
    responsibleName: responsibleId ? "Employee" : null,
    photoUrl: null,
    version: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    archivedAt: null,
  };
}

function createService(methods: Partial<InventoryItemRepository>) {
  const repositories = { items: methods as InventoryItemRepository } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  let sequence = 0;
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-08-01T12:00:00.000Z") },
    { create: () => `audit-${++sequence}` },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );
}

test("adds a canonical undirected component relation and audits both items", async () => {
  const records = [item(IDS[0]), item(IDS[1])];
  let inserted: Record<string, unknown> | undefined;
  const audits: Record<string, unknown>[] = [];
  const service = createService({
    findItemById: async (id) => records.find((value) => value.id === id) ?? null,
    insertComponent: async (value) => {
      inserted = value as unknown as Record<string, unknown>;
    },
    listComponents: async () => [records[1]],
    appendAudit: async (value) => {
      audits.push(value as unknown as Record<string, unknown>);
    },
  });

  const result = await service.addComponent(IDS[1].toUpperCase(), IDS[0], {
    userId: IDS[0],
    role: "admin",
  });

  assert.equal(inserted?.leftItemId, IDS[0]);
  assert.equal(inserted?.rightItemId, IDS[1]);
  assert.equal(result[0]?.id, IDS[1]);
  assert.deepEqual(audits.map((audit) => audit.subjectId).sort(), [...IDS].sort());
  assert.ok(audits.every((audit) => audit.action === "item.component_added"));
});

test("component mutations are administrator-only and reject self-links", async () => {
  const service = createService({
    findItemById: async (id) => item(id),
  });
  await assert.rejects(
    service.addComponent(IDS[0], IDS[1], { userId: "w", role: "warehouse" }),
    /forbidden/,
  );
  await assert.rejects(
    service.addComponent(IDS[0], IDS[0], { userId: IDS[0], role: "admin" }),
    /item_cannot_contain_itself/,
  );
});

test("employee sees only linked items assigned to them", async () => {
  const current = item(IDS[0], "employee-1");
  const assigned = item(IDS[1], "employee-1");
  const other = { ...item("33333333-3333-4333-8333-333333333333"), responsibleId: "employee-2" };
  const service = createService({
    findItemById: async () => current,
    listComponents: async () => [assigned, other],
  });
  const result = await service.listComponents(IDS[0], {
    userId: "employee-1",
    role: "employee",
  });
  assert.deepEqual(result.map((value) => value.id), [IDS[1]]);
});

test("removes the canonical relation and records before-value audits", async () => {
  const records = [item(IDS[0]), item(IDS[1])];
  let deleted: Record<string, unknown> | undefined;
  const audits: Record<string, unknown>[] = [];
  const service = createService({
    findItemById: async (id) => records.find((value) => value.id === id) ?? null,
    deleteComponent: async (value) => {
      deleted = value as unknown as Record<string, unknown>;
      return true;
    },
    listComponents: async () => [],
    appendAudit: async (value) => {
      audits.push(value as unknown as Record<string, unknown>);
    },
  });

  const result = await service.removeComponent(IDS[1], IDS[0], {
    userId: IDS[0],
    role: "admin",
  });

  assert.equal(deleted?.leftItemId, IDS[0]);
  assert.equal(deleted?.rightItemId, IDS[1]);
  assert.deepEqual(result, []);
  assert.ok(audits.every((audit) => audit.action === "item.component_removed"));
  assert.ok(audits.every((audit) => audit.beforeValues));
});

test("reports a missing relation without writing an audit", async () => {
  const records = [item(IDS[0]), item(IDS[1])];
  let auditCount = 0;
  const service = createService({
    findItemById: async (id) => records.find((value) => value.id === id) ?? null,
    deleteComponent: async () => false,
    appendAudit: async () => {
      auditCount += 1;
    },
  });

  await assert.rejects(
    service.removeComponent(IDS[0], IDS[1], {
      userId: IDS[0],
      role: "admin",
    }),
    /item_component_not_found/,
  );
  assert.equal(auditCount, 0);
});

test("does not add a decommissioned item to a composition", async () => {
  const active = item(IDS[0]);
  const decommissioned = { ...item(IDS[1]), status: "decommissioned" as const };
  let insertCount = 0;
  const service = createService({
    findItemById: async (id) =>
      [active, decommissioned].find((value) => value.id === id) ?? null,
    insertComponent: async () => {
      insertCount += 1;
    },
  });

  await assert.rejects(
    service.addComponent(IDS[0], IDS[1], {
      userId: IDS[0],
      role: "admin",
    }),
    /item_component_decommissioned/,
  );
  assert.equal(insertCount, 0);
});

test("searches a bounded candidate list for administrators", async () => {
  const current = item(IDS[0]);
  const candidate = item(IDS[1]);
  let search: { itemId: string; query: string; limit: number } | undefined;
  const service = createService({
    findItemById: async () => current,
    searchComponentCandidates: async (itemId, query, limit) => {
      search = { itemId, query, limit };
      return [candidate];
    },
  });

  const result = await service.searchComponentCandidates(
    IDS[0].toUpperCase(),
    "  Monitor  ",
    { userId: IDS[0], role: "admin" },
  );

  assert.deepEqual(search, { itemId: IDS[0], query: "Monitor", limit: 50 });
  assert.equal(result[0]?.id, IDS[1]);
  await assert.rejects(
    service.searchComponentCandidates(IDS[0], "x".repeat(101), {
      userId: IDS[0],
      role: "admin",
    }),
    /item_component_query_too_long/,
  );
});
