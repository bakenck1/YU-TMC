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
  const query = normalizeFilterText(filters.query);
  const location = filters.location === "all" ? "" : normalizeFilterText(filters.location);
  const floorRange = parseFloorRange(location);
  const brand = normalizeFilterText(filters.brand);
  const model = normalizeFilterText(filters.model);
  const itemType = normalizeFilterText(filters.itemType);
  const building = normalizeFilterText(filters.building);
  const responsible = normalizeFilterText(filters.responsible);
  return items.filter((item) => {
    const matchesQuery =
      !query ||
      normalizeFilterText(item.name).includes(query) ||
      normalizeFilterText(item.inventoryNumber).includes(query) ||
      normalizeFilterText(item.qrCode).includes(query);
    const itemBrand = normalizeFilterText(item.brand ?? item.brandModel);
    const itemModel = normalizeFilterText(item.model ?? item.brandModel);
    const itemBuilding = normalizeFilterText(item.building ?? item.location.split("/")[0]);
    const itemLocation = [item.location, item.room]
      .map(normalizeFilterText)
      .filter(Boolean)
      .join(" ");
    return Boolean(
      matchesQuery &&
        (filters.category === "all" || item.category === filters.category) &&
        (!location ||
          itemLocation.includes(location) ||
          (floorRange !== null && itemMatchesFloorRange(item, floorRange))) &&
        (!brand || itemBrand.includes(brand)) &&
        (!model || itemModel.includes(model)) &&
        (!itemType ||
          normalizeFilterText(item.name).includes(itemType) ||
          normalizeFilterText(item.itemType ?? item.category).includes(itemType)) &&
        (!building || itemBuilding.includes(building)) &&
        (!responsible || normalizeFilterText(item.responsible).includes(responsible)) &&
        matchesStatusFilter(item, filters.statusKey),
    );
  });
}

function normalizeFilterText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function parseFloorRange(value: string): { from: number; to: number } | null {
  const match = value.match(
    /^(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:\s*(?:этаж(?:а|ей|и)?|қабат(?:тар)?|floors?))?$/u,
  );
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return { from: Math.min(first, second), to: Math.max(first, second) };
}

function itemMatchesFloorRange(
  item: InventoryItem,
  range: { from: number; to: number },
): boolean {
  const floorNumber = item.floorNumber ?? floorNumberFromLocation(item.location);
  return floorNumber !== null && floorNumber >= range.from && floorNumber <= range.to;
}

function floorNumberFromLocation(location: string): number | null {
  const match = normalizeFilterText(location).match(
    /(?:^|\/)\s*(\d{1,2})\s*(?:этаж|қабат|floor)(?:\s|\/|$)/u,
  );
  return match ? Number(match[1]) : null;
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
