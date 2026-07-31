import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresInventoryItemRepositories } from "../lib/server/persistence/postgres/postgres-inventory-item-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

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
});
