import type { InventoryItem, ItemStatus } from "./types";

export type VisibleItemStatus =
  | { key: `display:${string}`; kind: "display"; value: string }
  | { key: `lifecycle:${ItemStatus}`; kind: "lifecycle"; value: ItemStatus };

export interface InventoryListFilters {
  query: string;
  category: string;
  location: string;
  statusKey: string;
}

export function visibleItemStatus(item: InventoryItem): VisibleItemStatus {
  return item.displayStatus
    ? { key: `display:${item.displayStatus}`, kind: "display", value: item.displayStatus }
    : { key: `lifecycle:${item.status}`, kind: "lifecycle", value: item.status };
}

export function filterInventoryItems(items: InventoryItem[], filters: InventoryListFilters) {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    const matchesQuery =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.inventoryNumber.toLowerCase().includes(query) ||
      item.qrCode?.toLowerCase().includes(query);
    return Boolean(
      matchesQuery &&
        (filters.category === "all" || item.category === filters.category) &&
        (filters.location === "all" || item.location === filters.location) &&
        (filters.statusKey === "all" || visibleItemStatus(item).key === filters.statusKey),
    );
  });
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
