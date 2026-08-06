import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("casts the resolving user id to UUID when archiving a maintenance item", () => {
  const source = readFileSync(
    new URL(
      "../lib/server/persistence/postgres/postgres-inventory-item-repositories.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /archived_by = case when \$2 = 'decommissioned' then \$3::uuid else null end/,
  );
});
