import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { supportsMaterialStatementOneCCode } from "../lib/inventory-categories";

test("material statement 1C code is limited to electrical equipment and components", () => {
  assert.equal(supportsMaterialStatementOneCCode("electrical_equipment"), true);
  assert.equal(supportsMaterialStatementOneCCode("components"), true);
  assert.equal(supportsMaterialStatementOneCCode("electronics"), false);
  assert.equal(supportsMaterialStatementOneCCode("furniture"), false);
  assert.equal(supportsMaterialStatementOneCCode("wifi_access_point"), false);
  assert.equal(supportsMaterialStatementOneCCode(null), false);
});

test("material statement 1C code has its own nullable database column", async () => {
  const [migration, schema, journal] = await Promise.all([
    readFile(
      new URL(
        "../drizzle/20260917091624_warm_shadowcat.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../lib/db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ]);

  assert.match(
    migration,
    /ADD COLUMN "one_c_code" varchar\(64\)/,
  );
  assert.match(schema, /oneCCode: varchar\(\{ length: 64 \}\)/);
  assert.ok(
    JSON.parse(journal).entries.some(
      (entry: { tag?: string }) => entry.tag === "20260917091624_warm_shadowcat",
    ),
  );
});
