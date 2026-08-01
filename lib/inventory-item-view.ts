import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { InventoryItem } from "@/lib/types";

export function toInventoryItemView(item: InventoryItemDto): InventoryItem {
  return {
    id: item.id,
    name: item.name,
    inventoryNumber: item.inventoryNumber,
    category: item.itemType as InventoryItem["category"],
    brand: item.brand ?? undefined,
    model: item.model ?? undefined,
    building: item.room.buildingName,
    room: item.room.designation,
    location: `${item.room.buildingName} / ${item.room.designation}`,
    responsible: item.responsible?.name ?? "",
    status: item.status,
    photoColor: "#0ea5e9",
    qrCode: item.qrCode ?? undefined,
    photo: item.photoUrl ?? undefined,
    displayStatus:
      item.inventoryNumberKind === "temporary"
        ? "Требует присвоения номера"
        : undefined,
    updatedAt: new Date(item.updatedAt).toLocaleDateString(),
    updatedAtIso: item.updatedAt,
    itemType: item.itemType,
    brandModel: [item.brand, item.model].filter(Boolean).join(" / ") || item.name,
    quantity: item.quantity,
    price: item.unitPrice,
  };
}

export function toDecommissionedInventoryItemView(
  item: InventoryItemDto,
): InventoryItem {
  const view = toInventoryItemView(item);
  const decommissionedAt = item.archivedAt
    ? new Date(item.archivedAt)
    : null;
  return {
    ...view,
    updatedAt: decommissionedAt?.toLocaleDateString(),
    decommissionedOn: decommissionedAt
      ? localDateInputValue(decommissionedAt)
      : undefined,
  };
}

function localDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
