import assert from "node:assert/strict";
import test from "node:test";
import type { InventoryItemRecord, InventoryItemRepository, InventoryItemRepositories, AppendItemAuditRecord } from "../lib/application/ports/inventory-item-repositories";
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

test("bulk code saves leading zeroes for every selected item including legacy categories without changing other fields", async () => {
  const h = harness();
  assert.deepEqual(await h.service.bulkChangeOneCCode([ID, SECOND], " 00000014398 ", ADMIN), {
    updatedItemIds: [ID, SECOND], oneCCode: "00000014398",
  });
  assert.deepEqual(h.records(), h.original.map((item) => ({ ...item, oneCCode: "00000014398", version: 4 })));
  assert.equal(h.audits().length, 2);
  assert.equal(h.audits()[0].action, "item.one_c_code_updated");
  assert.deepEqual(h.audits()[0].beforeValues, { oneCCode: null });
  assert.deepEqual(h.audits()[0].afterValues, { oneCCode: "00000014398" });
  await h.service.bulkChangeOneCCode([ID], "00042", ADMIN);
  assert.equal(h.records()[0].oneCCode, "00042");
  assert.equal(h.records()[1].oneCCode, "00000014398");
});

test("reapplying a saved code is a successful no-op", async () => {
  const h = harness({ code: "00042" });
  const result = await h.service.bulkChangeOneCCode([ID, SECOND], "00042", ADMIN);
  assert.deepEqual(result.updatedItemIds, [ID, SECOND]);
  assert.deepEqual(h.records(), h.original);
  assert.equal(h.audits().length, 0);
});

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

test("an unavailable or IT item and a concurrent write roll back all changes and audits", async () => {
  for (const options of [{ it: true }, { conflict: true }, {}]) {
    const h = harness(options);
    const ids = Object.keys(options).length ? [ID, SECOND] : [ID, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
    await assert.rejects(h.service.bulkChangeOneCCode(ids, "00042", ADMIN));
    assert.deepEqual(h.records(), h.original);
    assert.equal(h.audits().length, 0);
  }
});
