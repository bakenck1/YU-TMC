import type { LocalBarcodeGroupDto } from "@/lib/contracts/local-barcodes";
import { categoryFromLegacyType } from "@/lib/inventory-categories";
import type { InventoryItem } from "@/lib/types";

/** Presents an allocated local group as a regular active inventory row. */
export function toLocalBarcodeInventoryItem(
  group: LocalBarcodeGroupDto,
): InventoryItem {
  return {
    id: group.id,
    localGroupId: group.id,
    name: group.itemName,
    inventoryNumber: group.localBarcode,
    category: group.itemType.trim().toLocaleLowerCase("ru-RU") === "furniture"
      ? "furniture"
      : categoryFromLegacyType(group.itemType),
    brand: group.brand ?? undefined,
    model: group.model ?? undefined,
    buildingId: group.location.buildingId,
    building: group.location.buildingName,
    roomId: group.location.roomId,
    room: group.location.roomDesignation,
    location: `${group.location.buildingName} / ${group.location.roomDesignation}`,
    responsibleId: group.responsible.id,
    responsible: group.responsible.fullName,
    status: "active",
    photoColor: "#0ea5e9",
    photo: group.photoUrl ?? undefined,
    updatedAt: new Date(group.transferredAt).toLocaleDateString(),
    updatedAtIso: group.transferredAt,
    createdAt: new Date(group.transferredAt).toLocaleDateString(),
    additionalInfo: group.description ?? undefined,
    itemType: group.itemType,
    brandModel: [group.brand, group.model].filter(Boolean).join(" / ") || undefined,
    quantity: group.quantity,
    price: group.unitPrice,
    version: group.version,
  };
}
