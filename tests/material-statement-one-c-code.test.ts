import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
