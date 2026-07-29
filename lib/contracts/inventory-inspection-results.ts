import type { ItemResultValue } from "@/lib/contracts/inventory-domain";

export interface ItemResultDto {
  id: string;
  inspectionId: string;
  inspectionRoomId: string;
  itemId: string;
  itemName: string;
  inventoryNumber: string;
  registryRoomIdAtScan: string;
  responsibleIdAtScan: string | null;
  result: ItemResultValue;
  comment: string | null;
  revisionNumber: number;
  createdAt: string;
}

export interface RecordItemResultInput {
  itemId: string;
  result: ItemResultValue;
  comment?: string | null;
}
