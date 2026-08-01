import type { InventoryItem, ItemStatus } from "./types";
import { ITEM_STATUSES } from "./contracts/inventory-domain";

export type VisibleItemStatus =
  | { key: `display:${string}`; kind: "display"; value: string }
  | { key: `lifecycle:${ItemStatus}`; kind: "lifecycle"; value: ItemStatus };

export interface InventoryListFilters {
  query: string;
  category: string;
  location: string;
  statusKey: string;
  brand?: string;
  model?: string;
  itemType?: string;
  building?: string;
  responsible?: string;
}

export function visibleItemStatus(item: InventoryItem): VisibleItemStatus {
  return item.displayStatus
    ? { key: `display:${item.displayStatus}`, kind: "display", value: item.displayStatus }
    : { key: `lifecycle:${item.status}`, kind: "lifecycle", value: item.status };
}

export function inventoryStatusOptions(
  items: InventoryItem[],
): VisibleItemStatus[] {
  const values = new Map<string, VisibleItemStatus>(
    ITEM_STATUSES.map((status) => [
      `lifecycle:${status}`,
      { key: `lifecycle:${status}`, kind: "lifecycle", value: status },
    ]),
  );
  items.forEach((item) => {
    const status = visibleItemStatus(item);
    values.set(status.key, status);
  });
  return [...values.values()];
}

export function filterInventoryItems(items: InventoryItem[], filters: InventoryListFilters) {
  const query = filters.query.trim().toLowerCase();
  const brand = filters.brand?.trim().toLowerCase() ?? "";
  const model = filters.model?.trim().toLowerCase() ?? "";
  const itemType = filters.itemType?.trim().toLowerCase() ?? "";
  const building = filters.building?.trim().toLowerCase() ?? "";
  const responsible = filters.responsible?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    const matchesQuery =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.inventoryNumber.toLowerCase().includes(query) ||
      item.qrCode?.toLowerCase().includes(query);
    const itemBrand = (item.brand ?? item.brandModel ?? "").toLowerCase();
    const itemModel = (item.model ?? item.brandModel ?? "").toLowerCase();
    const itemBuilding = (item.building ?? item.location.split("/")[0] ?? "").trim().toLowerCase();
    return Boolean(
      matchesQuery &&
        (filters.category === "all" || item.category === filters.category) &&
        (filters.location === "all" ||
          (item.room ?? item.location)
            .toLowerCase()
            .includes(filters.location.trim().toLowerCase())) &&
        (!brand || itemBrand.includes(brand)) &&
        (!model || itemModel.includes(model)) &&
        (!itemType || (item.itemType ?? item.category).toLowerCase().includes(itemType)) &&
        (!building || itemBuilding.includes(building)) &&
        (!responsible || item.responsible.toLowerCase().includes(responsible)) &&
        matchesStatusFilter(item, filters.statusKey),
    );
  });
}

function matchesStatusFilter(item: InventoryItem, statusKey: string) {
  if (statusKey === "all") return true;
  if (statusKey.startsWith("lifecycle:")) {
    return statusKey === `lifecycle:${item.status}`;
  }
  return visibleItemStatus(item).key === statusKey;
}

export function paginateInventoryItems<T>(items: T[], requestedPage: number, pageSize: number) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Page size must be a positive integer");
  }
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    page,
    pageCount,
    pageItems,
    from: items.length === 0 ? 0 : startIndex + 1,
    to: items.length === 0 ? 0 : startIndex + pageItems.length,
    total: items.length,
  };
}
