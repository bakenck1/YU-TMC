import assert from "node:assert/strict";
import test from "node:test";
import type { InventoryItemRecord, InventoryItemRepository, InventoryItemRepositories, AppendItemAuditRecord } from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = { userId: ID, role: "admin" as const };

function harness(options: { it?: boolean; conflict?: boolean; alreadyProject?: boolean } = {}) {
  const original = [ID, SECOND].map((id) => ({
    id, name: "Monitor", itemSection: options.it && id === SECOND ? "it" : "general",
    isProject: options.alreadyProject ?? false, version: 3, status: "active",
    roomId: ID, inventoryNumber: "INV-1", responsibleId: ID,
  }) as InventoryItemRecord);
  let records = new Map(original.map((item) => [item.id, item]));
  let audits: AppendItemAuditRecord[] = [];
  const repository = {
    findItemById: async (id: string) => records.get(id) ?? null,
    updateItemProject: async (input: Parameters<InventoryItemRepository["updateItemProject"]>[0]) => {
      const current = records.get(input.id);
      if (!current || current.version !== input.expectedVersion || options.conflict) return null;
      const updated = { ...current, isProject: input.isProject, version: current.version + 1 };
      records.set(input.id, updated);
      return updated;
    },
    appendAudit: async (input: AppendItemAuditRecord) => { audits.push(input); },
  } as unknown as InventoryItemRepository;
  const repositories = { items: repository };
  const uow: UnitOfWork<InventoryItemRepositories> = {
    read: (work) => work(repositories),
    transaction: async (work) => {
      const before = new Map(records);
      const beforeAudits = [...audits];
      try { return await work(repositories); }
      catch (error) { records = before; audits = beforeAudits; throw error; }
    },
  };
  const service = new InventoryItemService(uow, { now: () => new Date("2026-10-30T00:00:00Z") }, { create: () => crypto.randomUUID() }, { create: () => new Uint8Array(16) }, { next: () => "TMP" });
  return { service, records: () => [...records.values()], audits: () => audits, original };
}

test("project bulk change updates all rows, preserves other fields, audits, and can remove the flag", async () => {
  const h = harness();
  assert.deepEqual(await h.service.bulkChangeProject([ID, SECOND], true, ADMIN), [ID, SECOND]);
  assert.deepEqual(h.records(), h.original.map((item) => ({ ...item, isProject: true, version: 4 })));
  assert.equal(h.audits().length, 2);
  assert.deepEqual(h.audits()[0].beforeValues, { isProject: false });
  assert.deepEqual(h.audits()[0].afterValues, { isProject: true });
  await h.service.bulkChangeProject([ID, SECOND], false, ADMIN);
  assert.ok(h.records().every((item) => !item.isProject && item.version === 5));
});

test("reapplying the project flag makes no extra writes or audit records", async () => {
  const h = harness({ alreadyProject: true });
  await h.service.bulkChangeProject([ID, SECOND], true, ADMIN);
  assert.deepEqual(h.records(), h.original);
  assert.equal(h.audits().length, 0);
});

test("bulk project remains admin-only and validates flags and selections", async () => {
  const h = harness();
  for (const role of ["employee", "warehouse", "typography"] as const) {
    await assert.rejects(h.service.bulkChangeProject([ID], true, { userId: ID, role }), /forbidden/);
  }
  for (const flag of [undefined, null, "true", 1]) {
    await assert.rejects(h.service.bulkChangeProject([ID], flag, ADMIN), /invalid_project_flag/);
  }
  for (const ids of [[], [ID, ID], ["invalid"], Array(2001).fill(ID)]) {
    await assert.rejects(h.service.bulkChangeProject(ids, true, ADMIN));
  }
  assert.deepEqual(h.records(), h.original);
});

test("a missing/IT row or version conflict fails the transaction without partial changes", async () => {
  for (const options of [{ it: true }, { conflict: true }, {}]) {
    const h = harness(options);
    const ids = Object.keys(options).length ? [ID, SECOND] : [ID, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
    await assert.rejects(h.service.bulkChangeProject(ids, true, ADMIN));
    assert.deepEqual(h.records(), h.original);
    assert.equal(h.audits().length, 0);
  }
});
