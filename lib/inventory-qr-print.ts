import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import { code39PayloadForItem } from "@/lib/domain/code39";

export type InventoryQrPrintKind = "barcode" | "qr";

export interface InventoryQrPrintItem {
  id: string;
  name: string;
  itemType: string;
  inventoryNumber: string;
  room: {
    designation: string;
    buildingName: string;
  };
  printableValue: string | null;
}

export function toInventoryQrPrintItem(
  item: InventoryItemDto,
  kind: InventoryQrPrintKind,
): InventoryQrPrintItem {
  return {
    id: item.id,
    name: item.name,
    itemType: item.itemType,
    inventoryNumber: item.inventoryNumber,
    room: {
      designation: item.room.designation,
      buildingName: item.room.buildingName,
    },
    printableValue:
      kind === "qr"
        ? item.qrCode
        : code39PayloadForItem(item.inventoryNumber, item.id),
  };
}
