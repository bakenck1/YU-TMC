import type { InventoryItem } from "@/lib/types";

export interface DecommissionedItemFilters {
  query: string;
  building: string;
  responsible: string;
  dateFrom: string;
  dateTo: string;
}

export function inventoryItemBuilding(item: InventoryItem): string {
  return item.location.split(" / ", 1)[0] ?? item.location;
}

export function filterDecommissionedItems(
  items: InventoryItem[],
  filters: DecommissionedItemFilters,
): InventoryItem[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const decommissionedOn = item.decommissionedOn ?? "";
    return (
      item.status === "decommissioned" &&
      (!normalizedQuery ||
        [
          item.name,
          item.inventoryNumber,
          item.itemType,
          item.brandModel,
        ].some((value) =>
          value?.toLocaleLowerCase().includes(normalizedQuery),
        )) &&
      (filters.building === "all" ||
        inventoryItemBuilding(item) === filters.building) &&
      (filters.responsible === "all" ||
        item.responsible === filters.responsible) &&
      (!filters.dateFrom || decommissionedOn >= filters.dateFrom) &&
      (!filters.dateTo || decommissionedOn <= filters.dateTo)
    );
  });
}
