import assert from "node:assert/strict";
import test from "node:test";

import {
categoryFromLegacyType,
INVENTORY_ITEM_CATEGORIES,
inventoryItemCategoryTranslationKey,
isInventoryItemCategory,
} from "../lib/inventory-categories";

test("supports all first-class inventory categories", () => {
  assert.deepEqual(INVENTORY_ITEM_CATEGORIES, [
    "electronics",
    "electrical_equipment",
    "furniture",
    "household_inventory",
    "components",
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
  assert.equal(isInventoryItemCategory("components"), true);
  assert.equal(
    inventoryItemCategoryTranslationKey("components"),
    "data.components",
  );
  assert.equal(categoryFromLegacyType("Комплектующие"), "components");
});
