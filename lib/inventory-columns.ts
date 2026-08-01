export const INVENTORY_COLUMN_KEYS = [
  "photo",
  "qrCode",
  "itemType",
  "brandModel",
  "location",
  "status",
  "responsible",
  "additionalInfo",
  "updatedAt",
  "createdAt",
  "quantity",
  "price",
] as const;

export type InventoryColumnKey = (typeof INVENTORY_COLUMN_KEYS)[number];
export type InventoryColumnVisibility = Record<InventoryColumnKey, boolean>;

export const DEFAULT_INVENTORY_COLUMNS: InventoryColumnVisibility = {
  photo: true,
  qrCode: true,
  itemType: true,
  brandModel: true,
  location: true,
  status: true,
  responsible: true,
  additionalInfo: false,
  updatedAt: true,
  createdAt: false,
  quantity: true,
  price: true,
};

export function parseInventoryColumnVisibility(
  value: string | null,
): InventoryColumnVisibility {
  if (!value) return { ...DEFAULT_INVENTORY_COLUMNS };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_INVENTORY_COLUMNS };
    }
    const record = parsed as Record<string, unknown>;
    return Object.fromEntries(
      INVENTORY_COLUMN_KEYS.map((key) => [
        key,
        typeof record[key] === "boolean"
          ? record[key]
          : DEFAULT_INVENTORY_COLUMNS[key],
      ]),
    ) as InventoryColumnVisibility;
  } catch {
    return { ...DEFAULT_INVENTORY_COLUMNS };
  }
}
