import assert from "node:assert/strict";
import test from "node:test";
import type { AppendItemAuditRecord,InventoryItemRecord,InventoryItemRepositories,InventoryItemRepository } from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = { userId: ID, role: "admin" as const };

function harness(options: { it?: boolean; conflict?: boolean; code?: string } = {}) {
  const original = [ID, SECOND].map((id) => ({
    id, name: "Chair", itemSection: options.it && id === SECOND ? "it" : "general",
    itemType: "Legacy furniture", oneCCode: options.code ?? null, version: 3, status: "active",
    roomId: ID, inventoryNumber: "INV-1", responsibleId: ID, quantity: 28, unitPrice: 50,
  }) as InventoryItemRecord);
  let records = new Map(original.map((item) => [item.id, item]));
  let audits: AppendItemAuditRecord[] = [];
  let transactions = 0;
  const repository = {
    findItemById: async (id: string) => records.get(id) ?? null,
    updateItemOneCCode: async (input: Parameters<InventoryItemRepository["updateItemOneCCode"]>[0]) => {
      const current = records.get(input.id);
      if (!current || current.version !== input.expectedVersion || (options.conflict && input.id === SECOND)) return null;
      const updated = { ...current, oneCCode: input.oneCCode, version: current.version + 1 };
      records.set(input.id, updated);
      return updated;
    },
    appendAudit: async (input: AppendItemAuditRecord) => { audits.push(input); },
  } as unknown as InventoryItemRepository;
  const repositories = { items: repository };
  const uow: UnitOfWork<InventoryItemRepositories> = {
    read: (work) => work(repositories),
    transaction: async (work, options) => {
      transactions += 1;
      assert.deepEqual(options, { isolation: "serializable", maxAttempts: 3 });
      const before = new Map(records);
      const beforeAudits = [...audits];
      try { return await work(repositories); }
      catch (error) { records = before; audits = beforeAudits; throw error; }
    },
  };
  const service = new InventoryItemService(uow, { now: () => new Date("2026-11-03T00:00:00Z") }, { create: () => crypto.randomUUID() }, { create: () => new Uint8Array(16) }, { next: () => "TMP" });
  return { service, records: () => [...records.values()], audits: () => audits, transactions: () => transactions, original };
}

test("bulk code rejects invalid codes, invalid selections and non-admins before opening a transaction", async () => {
  const h = harness();
  for (const role of ["employee", "warehouse", "typography"] as const) {
    await assert.rejects(h.service.bulkChangeOneCCode([ID], "00042", { userId: ID, role }), /forbidden/);
  }
  for (const code of [undefined, null, "", "   ", 14398, {}, "x".repeat(65), "00\n42", "00\u000042"]) {
    await assert.rejects(h.service.bulkChangeOneCCode([ID], code, ADMIN), /invalid_one_c_code/);
  }
  for (const ids of [[], [ID, ID], ["invalid"], Array(2001).fill(ID)]) {
    await assert.rejects(h.service.bulkChangeOneCCode(ids, "00042", ADMIN));
  }
  assert.equal(h.transactions(), 0);
  assert.deepEqual(h.records(), h.original);
});
