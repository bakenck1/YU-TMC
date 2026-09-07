import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  categoryFromLegacyType,
  INVENTORY_ITEM_CATEGORIES,
  inventoryItemCategoryTranslationKey,
  isInventoryItemCategory,
} from "../lib/inventory-categories";

test("supports electrical equipment as a first-class inventory category", () => {
  assert.deepEqual(INVENTORY_ITEM_CATEGORIES, [
    "electronics",
    "electrical_equipment",
    "furniture",
  ]);
  assert.equal(isInventoryItemCategory("electrical_equipment"), true);
  assert.equal(
    inventoryItemCategoryTranslationKey("electrical_equipment"),
    "data.electricalEquipment",
  );
  assert.equal(categoryFromLegacyType("electrical_equipment"), "electrical_equipment");
  assert.equal(
    categoryFromLegacyType("\u042d\u043b\u0435\u043a\u0442\u0440\u043e\u043e\u0431\u043e\u0440\u0443\u0434\u043e\u0432\u0430\u043d\u0438\u0435"),
    "electrical_equipment",
  );
});

test("database migration allows the electrical equipment category", async () => {
  const [migration, schema, journal] = await Promise.all([
    readFile(
      new URL(
        "../drizzle/20260907113517_electrical_equipment_category.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../lib/db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ]);

  const allowedValues = /'electronics', 'electrical_equipment', 'furniture'/;
  assert.match(migration, allowedValues);
  assert.match(schema, allowedValues);
  assert.ok(
    JSON.parse(journal).entries.some(
      (entry: { tag?: string }) => entry.tag === "20260907113517_electrical_equipment_category",
    ),
  );
});
