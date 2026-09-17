import type { InventoryColumnVisibility } from "@/lib/inventory-columns";

export function isCompleteInventoryExport(
  completeDataset: boolean,
  query: string,
  activeFilterCount: number,
): boolean {
  return completeDataset && query.trim() === "" && activeFilterCount === 0;
}

export function createInventoryExportPayload(
  dataset: "items" | "it-items" | "decommissioned" | "decommissioned_in_use",
  itemIds: readonly string[],
  columns: InventoryColumnVisibility,
  completeDataset = false,
) {
  if (!completeDataset && itemIds.length > 2_000) {
    throw new Error("inventory_export_selection_too_large");
  }
  return {
    dataset,
    ...(completeDataset ? {} : { itemIds: [...itemIds] }),
    columns: exportColumnKeys(columns, dataset),
  };
}

function exportColumnKeys(
  columns: InventoryColumnVisibility,
  dataset: "items" | "it-items" | "decommissioned" | "decommissioned_in_use",
) {
  const keys = ["name", "inventoryNumber"];
  if (dataset !== "it-items") keys.push("oneCCode");
  if (dataset !== "it-items" && columns.qrCode) keys.push("qrCode");
  if (columns.itemType) keys.push("itemType");
  if (columns.brandModel) keys.push("brand", "model");
  if (columns.location) keys.push("building", "room");
  if (columns.ipAddress) keys.push("ipAddress");
  if (columns.macAddress) keys.push("macAddress");
  if (columns.status) keys.push("status");
  if (dataset !== "it-items" && columns.responsible) keys.push("responsible");
  if (columns.additionalInfo) keys.push("description");
  if (columns.quantity) keys.push("quantity");
  if (columns.price) keys.push("unitPrice", "total");
  if (columns.createdAt) keys.push("createdAt");
  if (columns.updatedAt) keys.push("updatedAt");
  keys.push("exportedAt");
  return keys;
}
