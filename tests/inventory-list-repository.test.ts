import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresInventoryItemRepositories } from "../lib/server/persistence/postgres/postgres-inventory-item-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

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
