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
  /** Photograph attached to the latest service request; it never replaces photoUrl. */
  servicePhotoUrl?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  maintenanceStartedAt?: string | null;
  archivedAt: string | null;
}

export interface InventoryItemAuditDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: "admin" | "warehouse" | "employee" | null;
  subjectRevision: number | null;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  occurredAt: string;
}

export interface InventoryItemOperationDto {
  id: string;
  kind: "item" | "responsibility" | "transfer";
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  occurredAt: string;
  detail: {
    componentName?: string;
    componentInventoryNumber?: string;
    targetName?: string;
    itemName?: string;
    serviceName?: string;
    reason?: string;
    source?: string;
    status?: string;
    outcome?: string;
    fromRoomId?: string;
    toRoomId?: string;
    fromLocation?: string;
    toLocation?: string;
    comment?: string;
  } | null;
}

export interface InventoryItemCommentDto {
  id: string;
  authorName: string;
  authorEmail: string;
  message: string;
  createdAt: string;
  attachment: {
    id: string;
    fileName: string;
    mediaType: string;
    sizeBytes: number;
    downloadUrl: string;
  } | null;
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
  /** Barcode value entered or scanned from the item's label. */
  barcode?: string | null;
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
