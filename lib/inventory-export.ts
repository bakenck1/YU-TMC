import type { InventoryColumnVisibility } from "@/lib/inventory-columns";

export function createInventoryExportPayload(
  dataset: "items" | "decommissioned",
  itemIds: readonly string[],
  columns: InventoryColumnVisibility,
) {
  return {
    dataset,
    itemIds: [...itemIds],
    columns: exportColumnKeys(columns),
  };
}

function exportColumnKeys(columns: InventoryColumnVisibility) {
  const keys = ["name", "inventoryNumber"];
  if (columns.qrCode) keys.push("qrCode");
  if (columns.itemType) keys.push("itemType");
  if (columns.brandModel) keys.push("brand", "model");
  if (columns.location) keys.push("building", "room");
  if (columns.status) keys.push("status");
  if (columns.responsible) keys.push("responsible");
  if (columns.additionalInfo) keys.push("description");
  if (columns.quantity) keys.push("quantity");
  if (columns.price) keys.push("unitPrice", "total");
  if (columns.createdAt) keys.push("createdAt");
  if (columns.updatedAt) keys.push("updatedAt");
  keys.push("exportedAt");
  return keys;
}
