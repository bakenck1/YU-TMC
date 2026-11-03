import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresInventoryItemRepositories } from "../lib/server/persistence/postgres/postgres-inventory-item-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

test("dedicated 1C code mutation uses a version check, touches only its field and reloads the saved value", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const now = new Date("2026-11-03T00:00:00Z");
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const source = {
    query: async (sql: string, values: readonly unknown[] = []) => {
      calls.push({ sql, values });
      return { rows: [{ id, one_c_code: "000014398", quantity: 28, unit_price: 50, created_at: now, updated_at: now }], rowCount: 1 };
    },
  } as unknown as PostgresRepositorySource;
  const saved = await createPostgresInventoryItemRepositories(source).items.updateItemOneCCode({
    id, oneCCode: "000014398", actorId: id, expectedVersion: 3, occurredAt: now,
  });
  assert.equal(saved?.oneCCode, "000014398");
  assert.equal(saved?.quantity, 28);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /set one_c_code = \$2, updated_by = \$3, updated_at = \$4,\s+version = version \+ 1/);
  assert.match(calls[0].sql, /where id = \$1 and version = \$5 and item_section = 'general'/);
  assert.deepEqual(calls[0].values, [id, "000014398", id, now, 3]);
});

test("a stale 1C code write does not reload or return an unsaved item", async () => {
  let queries = 0;
  const source = { query: async () => { queries++; return { rows: [], rowCount: 0 }; } } as unknown as PostgresRepositorySource;
  const result = await createPostgresInventoryItemRepositories(source).items.updateItemOneCCode({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", oneCCode: "00042", actorId: "admin", expectedVersion: 3, occurredAt: new Date(),
  });
  assert.equal(result, null);
  assert.equal(queries, 1);
});

test("only employee collections check responsibility before pagination while every row retains its responsible person", async () => {
  const queries: string[] = [];
  const source = { query: async (sql: string) => {
    queries.push(sql);
    return { rows: [], rowCount: 0 };
  } } as unknown as PostgresRepositorySource;
  const repository = createPostgresInventoryItemRepositories(source).items;
  await repository.listItems();
  await repository.listItItems();
  await repository.listDecommissionedItems();
  await repository.listItemsAssignedTo("employee-1");
  await repository.listDecommissionedItemsAssignedTo("employee-1");
  for (const [index, sql] of queries.entries()) {
    const selected = sql.slice(0, sql.indexOf("select i.id, i.name"));
    const projection = sql.slice(sql.indexOf("select i.id, i.name"));
    if (index < 3) assert.doesNotMatch(selected, /responsibility_periods/);
    else {
      assert.match(selected, /responsibility_periods/);
      assert.match(selected, /rp\.responsible_user_id = \$1 or r\.primary_responsible_id = \$1/);
    }
    assert.match(projection, /responsibility_periods/);
    assert.match(projection, /u\.full_name as responsible_name/);
  }
});

test("general inventory queries include archived and decommissioned items", async () => {
  const queries: string[] = [];
  const source = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PostgresRepositorySource;
  const repository = createPostgresInventoryItemRepositories(source).items;

  await repository.listItems();
  await repository.listItemsAssignedTo("employee-1");

  assert.equal(queries.length, 2);
  assert.doesNotMatch(queries[0]!, /archived_at\s+is\s+null/i);
  assert.doesNotMatch(queries[0]!, /status\s+<>\s+'decommissioned'/i);
  assert.match(queries[1]!, /responsible_user_id\s*=\s*\$1/i);
  assert.doesNotMatch(queries[1]!, /archived_at\s+is\s+null/i);
  assert.ok(queries[0]!.indexOf("limit 500") < queries[0]!.indexOf("service_move on true"));
  assert.ok(queries[0]!.indexOf("limit 500") < queries[0]!.indexOf(") p on true"));
});

test("inventory collection uses stable bounded keyset pages beyond 10,000 rows", async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  let page = 0;
  const source = {
    query: async (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values });
      const currentPage = page++;
      const count = currentPage < 50 ? 500 : 0;
      const rows = Array.from({ length: count }, (_, index) => ({
        id: `${String(currentPage).padStart(4, "0")}-${String(index).padStart(4, "0")}`,
        updated_at: new Date(Date.UTC(2026, 8, 9) - (currentPage * 500 + index) * 1_000),
        updated_at_cursor: `2026-09-09 00:00:00.${String(999_999 - currentPage * 500 - index).padStart(6, "0")}+00`,
        quantity: 1,
        unit_price: 1,
      }));
      return { rows, rowCount: rows.length };
    },
  } as unknown as PostgresRepositorySource;

  const records = await createPostgresInventoryItemRepositories(source).items.listItems();

  assert.equal(records.length, 25_000);
  assert.equal(queries.length, 51);
  assert.equal(queries.slice(0, -1).every(({ text }) => /limit 500\s*\)/i.test(text)), true);
  assert.match(queries.at(-1)!.text, /limit 1\s*\)/i);
  assert.equal(queries[0]!.values.length, 0);
  assert.match(queries[1]!.text, /i\.updated_at < \$1/);
  assert.match(queries[1]!.text, /i\.id > \$2/);
  assert.equal(queries[1]!.values.length, 2);
  assert.equal(queries[1]!.values[0], "2026-09-09 00:00:00.999500+00");
});

test("inventory collection fails explicitly above the supported 25,000-row contract", async () => {
  let call = 0;
  const source = {
    query: async () => {
      const count = call++ < 50 ? 500 : 1;
      const rows = Array.from({ length: count }, (_, index) => ({
        id: `${String(call).padStart(4, "0")}-${String(index).padStart(4, "0")}`,
        updated_at: new Date(Date.UTC(2026, 8, 9) - call * 1_000 - index),
        updated_at_cursor: `2026-09-09 00:00:00.${String(999_999 - call * 500 - index).padStart(6, "0")}+00`,
        quantity: 1,
        unit_price: 1,
      }));
      return { rows, rowCount: rows.length };
    },
  } as unknown as PostgresRepositorySource;

  await assert.rejects(
    createPostgresInventoryItemRepositories(source).items.listItems(),
    (error: unknown) => error instanceof Error &&
      "publicCode" in error && error.publicCode === "inventory_collection_requires_async_export",
  );
  assert.equal(call, 51);
});


for (const kind of ["official", "temporary"] as const) {
  test(`item creation preserves the first ${kind} number and its assignment time`, async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const occurredAt = new Date("2026-11-03T00:00:00Z");
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const source = {
      query: async (sql: string, values: readonly unknown[] = []) => {
        calls.push({ sql, values });
        return { rows: [{ id, quantity: 1, unit_price: 1, created_at: occurredAt, updated_at: occurredAt }], rowCount: 1 };
      },
    } as unknown as PostgresRepositorySource;
    const repository = createPostgresInventoryItemRepositories(source).items;
    await repository.insertItem({
      id, name: "Monitor", description: null, itemType: "electronics", itemSection: "general",
      itType: null, brand: null, model: null, quantity: 1, unitPrice: 1, roomId: id,
      inventoryNumberKind: kind, inventoryNumber: "INV-1", inventoryNumberKey: "INV1", actorId: id, occurredAt,
    });
    const history = calls.filter(({ sql }) => sql.includes('insert into "yu_inventory"."item_inventory_number_history"'));
    assert.equal(history.length, 1);
    assert.match(history[0]!.sql, /assigned_by, assigned_at/);
    assert.deepEqual(history[0]!.values.slice(1), [id, kind, "INV-1", "INV1", id, occurredAt]);
  });
}
