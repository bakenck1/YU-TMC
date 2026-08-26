export const INVENTORY_ITEM_CATEGORIES = ["electronics", "furniture"] as const;

export type InventoryItemCategory = (typeof INVENTORY_ITEM_CATEGORIES)[number];

export function isInventoryItemCategory(
  value: unknown,
): value is InventoryItemCategory {
  return (
    typeof value === "string" &&
    INVENTORY_ITEM_CATEGORIES.includes(value as InventoryItemCategory)
  );
}

/**
 * Imports and test fixtures created before categories were introduced may still
 * carry their old free-form type. The public API never accepts those values;
 * this fallback only lets trusted legacy callers receive a safe category.
 */
export function categoryFromLegacyType(value: string): InventoryItemCategory {
  return value.trim().toLocaleLowerCase("ru-RU") === "мебель"
    ? "furniture"
    : "electronics";
}
