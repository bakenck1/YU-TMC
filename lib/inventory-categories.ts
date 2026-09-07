export const INVENTORY_ITEM_CATEGORIES = [
  "electronics",
  "electrical_equipment",
  "furniture",
] as const;

export type InventoryItemCategory = (typeof INVENTORY_ITEM_CATEGORIES)[number];

export type InventoryItemCategoryTranslationKey =
  | "common.electronics"
  | "data.electricalEquipment"
  | "data.furniture";

export function isInventoryItemCategory(
  value: unknown,
): value is InventoryItemCategory {
  return (
    typeof value === "string" &&
    INVENTORY_ITEM_CATEGORIES.includes(value as InventoryItemCategory)
  );
}

export function inventoryItemCategoryTranslationKey(
  category: InventoryItemCategory,
): InventoryItemCategoryTranslationKey {
  if (category === "electrical_equipment") return "data.electricalEquipment";
  return category === "furniture" ? "data.furniture" : "common.electronics";
}

/**
 * Imports and test fixtures created before categories were introduced may still
 * carry their old free-form type. The public API never accepts those values;
 * this fallback only lets trusted legacy callers receive a safe category.
 */
export function categoryFromLegacyType(value: string): InventoryItemCategory {
  const normalized = value.trim().toLocaleLowerCase("ru-RU");
  if (normalized === "furniture" || normalized === "\u043c\u0435\u0431\u0435\u043b\u044c") {
    return "furniture";
  }
  if (
    normalized === "electrical_equipment" ||
    normalized === "electrical equipment" ||
    normalized === "\u044d\u043b\u0435\u043a\u0442\u0440\u043e\u043e\u0431\u043e\u0440\u0443\u0434\u043e\u0432\u0430\u043d\u0438\u0435"
  ) {
    return "electrical_equipment";
  }
  return "electronics";
}
