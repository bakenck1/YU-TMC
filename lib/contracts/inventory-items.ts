import type {
  InventoryNumberKind,
  ItemStatus,
} from "@/lib/contracts/inventory-domain";

export interface InventoryItemDto {
  id: string;
  name: string;
  description: string | null;
  itemType: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unitPrice: number;
  inventoryNumberKind: InventoryNumberKind;
  inventoryNumber: string;
  room: {
    id: string;
    designation: string;
    floorNumber: number;
    buildingId: string;
    buildingName: string;
  };
  status: ItemStatus;
  qrCode: string | null;
  responsible: {
    id: string;
    name: string;
  } | null;
  photoUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInventoryItemInput {
  name: string;
  description?: string | null;
  itemType?: string | null;
  brand?: string | null;
  model?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  roomId: string;
  inventoryNumber?: string | null;
}

export interface UpdateInventoryItemContentInput {
  version: number;
  name: string;
  description?: string | null;
  itemType?: string | null;
  brand?: string | null;
  model?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
}

export interface UpdateInventoryItemPhotoInput {
  version: number;
  imageDataUrl: string;
  width: number;
  height: number;
}

export interface UpdateInventoryItemProtectedInput {
  version: number;
  roomId: string;
  inventoryNumber: string;
  status: ItemStatus;
  replaceQr?: boolean;
  qrReplaceReason?: string | null;
}
