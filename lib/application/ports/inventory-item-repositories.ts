import type { InventoryNumberKind, ItemStatus } from "@/lib/contracts/inventory-domain";
import type { UserRole } from "@/lib/contracts/users";

export interface InventoryItemRecord {
  id: string;
  name: string;
  description: string | null;
  itemType: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unitPrice: number;
  roomId: string;
  roomDesignation: string;
  floorNumber: number;
  buildingId: string;
  buildingName: string;
  inventoryNumberKind: InventoryNumberKind;
  inventoryNumber: string;
  status: ItemStatus;
  qrCode: string | null;
  responsibleId: string | null;
  responsibleName: string | null;
  photoUrl: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  maintenanceStartedAt?: Date | null;
  archivedAt: Date | null;
}

export interface InsertInventoryItemRecord {
  id: string;
  name: string;
  description: string | null;
  itemType: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unitPrice: number;
  roomId: string;
  inventoryNumberKind: InventoryNumberKind;
  inventoryNumber: string;
  inventoryNumberKey: string;
  actorId: string;
  occurredAt: Date;
}

export interface UpdateInventoryItemContentRecord {
  id: string;
  name: string;
  description: string | null;
  itemType: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unitPrice: number;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface UpdateInventoryItemPhotoRecord {
  id: string;
  photoId: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface StoredItemPhoto {
  bytes: Uint8Array;
  mimeType: "image/jpeg";
}

export interface UpdateInventoryItemProtectedRecord {
  id: string;
  roomId: string;
  inventoryNumberKind: InventoryNumberKind;
  inventoryNumber: string;
  inventoryNumberKey: string;
  status: ItemStatus;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface UpdateInventoryItemStatusRecord {
  id: string;
  status: ItemStatus;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface ResolveMaintenanceItemRecord {
  id: string;
  status: "active" | "decommissioned";
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface ArchiveInventoryItemRecord {
  id: string;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface InsertItemQrRecord {
  id: string;
  itemId: string;
  value: string;
  actorId: string;
}

export interface ReplaceItemQrRecord extends InsertItemQrRecord {
  revokedAt: Date;
  revokeReason: string;
}

export interface AppendItemAuditRecord {
  id: string;
  actorId: string;
  actorRole: UserRole;
  subjectId: string;
  subjectRevision: number;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  occurredAt: Date;
}

export interface ChangeItemComponentRecord {
  leftItemId: string;
  rightItemId: string;
  actorId: string;
  occurredAt: Date;
}

export interface InventoryItemAuditRecord {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: UserRole | null;
  subjectRevision: number | null;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  occurredAt: Date;
}

export interface InventoryItemOperationRecord {
  id: string;
  kind: "item" | "responsibility" | "transfer";
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  targetName: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  occurredAt: Date;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
}

export interface InventoryItemCommentRecord {
  id: string;
  authorName: string;
  authorEmail: string;
  message: string;
  createdAt: Date;
  attachment: {
    id: string;
    fileName: string;
    mediaType: string;
    sizeBytes: number;
  } | null;
}

export interface InsertInventoryItemCommentAttachmentRecord {
  id: string;
  commentId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  binaryData: Uint8Array;
  createdAt: Date;
}

export interface StoredInventoryItemCommentAttachment
  extends InsertInventoryItemCommentAttachmentRecord {
  itemId: string;
}

export interface InventoryItemRepository {
  roomExists(id: string): Promise<boolean>;
  listItems(): Promise<InventoryItemRecord[]>;
  listItemsAssignedTo(userId: string): Promise<InventoryItemRecord[]>;
  listDecommissionedItems(): Promise<InventoryItemRecord[]>;
  listDecommissionedItemsAssignedTo(
    userId: string,
  ): Promise<InventoryItemRecord[]>;
  findItemById(id: string): Promise<InventoryItemRecord | null>;
  listComponents(itemId: string): Promise<InventoryItemRecord[]>;
  listOperations(itemId: string): Promise<InventoryItemOperationRecord[]>;
  listComments(itemId: string): Promise<InventoryItemCommentRecord[]>;
  insertCommentAttachment(input: InsertInventoryItemCommentAttachmentRecord): Promise<void>;
  findCommentAttachment(
    itemId: string,
    commentId: string,
    attachmentId: string,
  ): Promise<StoredInventoryItemCommentAttachment | null>;
  searchComponentCandidates(
    itemId: string,
    query: string,
    limit: number,
  ): Promise<InventoryItemRecord[]>;
  insertComponent(input: ChangeItemComponentRecord): Promise<void>;
  deleteComponent(input: ChangeItemComponentRecord): Promise<boolean>;
  insertItem(input: InsertInventoryItemRecord): Promise<InventoryItemRecord>;
  updateItemContent(
    input: UpdateInventoryItemContentRecord,
  ): Promise<InventoryItemRecord | null>;
  updateItemPhoto(
    input: UpdateInventoryItemPhotoRecord,
  ): Promise<InventoryItemRecord | null>;
  findItemPhoto(id: string): Promise<StoredItemPhoto | null>;
  updateItemProtected(
    input: UpdateInventoryItemProtectedRecord,
  ): Promise<InventoryItemRecord | null>;
  updateItemStatus(
    input: UpdateInventoryItemStatusRecord,
  ): Promise<InventoryItemRecord | null>;
  resolveMaintenanceItem(
    input: ResolveMaintenanceItemRecord,
  ): Promise<InventoryItemRecord | null>;
  archiveItem(input: ArchiveInventoryItemRecord): Promise<InventoryItemRecord | null>;
  insertItemQr(input: InsertItemQrRecord): Promise<void>;
  replaceItemQr(input: ReplaceItemQrRecord): Promise<void>;
  appendAudit(input: AppendItemAuditRecord): Promise<void>;
  listAudit(itemId: string): Promise<InventoryItemAuditRecord[]>;
}

export interface InventoryItemRepositories {
  items: InventoryItemRepository;
}
