import type { InventoryItem } from "@/lib/types";

export const INVENTORY_SUMMARY_KINDS = [
  "totalValue",
  "totalItems",
  "maintenance",
  "decommissioned",
] as const;

export type InventorySummaryKind = (typeof INVENTORY_SUMMARY_KINDS)[number];

export interface InventorySummary {
  totalValue: number;
  totalItems: number;
  maintenance: number;
  decommissioned: number;
}

export function inventoryLineValue(item: InventoryItem): number {
  return (item.quantity ?? 1) * (item.price ?? 0);
}

export function summarizeInventory(items: InventoryItem[]): InventorySummary {
  return {
    totalValue: items.reduce(
      (total, item) => total + (
        item.status === "decommissioned" || item.status === "decommissioned_in_use"
          ? 0
          : inventoryLineValue(item)
      ),
      0,
    ),
    totalItems: items.length,
    maintenance: items.filter((item) => item.status === "maintenance").length,
    decommissioned: items.filter(
      (item) => item.status === "decommissioned" || item.status === "decommissioned_in_use",
    ).length,
  };
}

export function itemsForInventorySummary(
  items: InventoryItem[],
  kind: InventorySummaryKind,
): InventoryItem[] {
  switch (kind) {
    case "maintenance":
      return items.filter((item) => item.status === "maintenance");
    case "decommissioned":
      return items.filter(
        (item) => item.status === "decommissioned" || item.status === "decommissioned_in_use",
      );
    default:
      return items;
  }
}
