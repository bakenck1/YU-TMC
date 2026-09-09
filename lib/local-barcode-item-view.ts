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
    category: categoryFromLegacyType(group.itemType),
    brand: group.brand ?? undefined,
    model: group.model ?? undefined,
    buildingId: group.location.buildingId,
    building: group.location.buildingName,
    roomId: group.location.roomId,
    room: group.location.roomDesignation,
    floorNumber: group.location.floorNumber,
    location: group.location.floorNumber === undefined
      ? `${group.location.buildingName} / ${group.location.roomDesignation}`
      : `${group.location.buildingName} / ${group.location.floorNumber} этаж / ${group.location.roomDesignation}`,
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
