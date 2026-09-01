import type { IdempotencyRequestRepository } from "@/lib/application/ports/inventory-concurrency-repositories";
import type { UserRole } from "@/lib/contracts/users";

export interface LocalBarcodeActorRecord {
  id: string;
  role: UserRole;
  active: boolean;
  deletedAt: Date | null;
  version: number;
}

export interface LocalBarcodeItemRecord {
  id: string;
  name: string;
  inventoryNumber: string;
  quantity: number;
  version: number;
  status: "active" | "maintenance" | "decommissioned";
  responsibleUserId: string | null;
  responsibleName: string | null;
  roomId: string;
  roomDesignation: string;
  buildingId: string;
  buildingName: string;
}

export interface LocalBarcodeGroupRecord {
  id: string;
  itemId: string;
  itemName: string;
  originalBarcode: string;
  itemType: string;
  itemBrand: string | null;
  itemModel: string | null;
  itemDescription: string | null;
  unitPrice: number;
  itemPhotoId: string | null;
  parentGroupId: string | null;
  sequenceNumber: bigint;
  barcodeValue: string;
  barcodeKey: string;
  quantity: number;
  responsibleUserId: string;
  responsibleName: string;
  roomId: string;
  roomDesignation: string;
  buildingId: string;
  buildingName: string;
  previousResponsibleUserId: string | null;
  previousResponsibleName: string | null;
  previousRoomId: string | null;
  createdBy: string;
  createdAt: Date;
  transferredAt: Date;
  status: "active" | "cancelled";
  cancelledBy: string | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  version: number;
}

export interface LocalBarcodeRecipientRecord {
  id: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  deletedAt: Date | null;
  defaultRoomId: string | null;
  roomActive: boolean;
}

export interface LocalBarcodeEventRecord {
  id: string;
  eventType: "created" | "transferred" | "split" | "cancelled";
  actorId: string;
  actorName: string;
  fromResponsibleUserId: string | null;
  fromResponsibleName: string | null;
  toResponsibleUserId: string | null;
  toResponsibleName: string | null;
  quantity: number;
  roomId: string;
  roomDesignation: string;
  buildingId: string;
  buildingName: string;
  reason: string | null;
  occurredAt: Date;
}

export interface LocalBarcodeStoredPhoto {
  bytes: Uint8Array;
  mimeType: "image/jpeg";
}

export interface InsertLocalBarcodeGroup {
  id: string;
  itemId: string;
  parentGroupId: string | null;
  sequenceNumber: bigint;
  barcodeValue: string;
  barcodeKey: string;
  quantity: number;
  responsibleUserId: string;
  roomId: string;
  previousResponsibleUserId: string | null;
  previousRoomId: string;
  createdBy: string;
  occurredAt: Date;
}

export interface LocalBarcodeRepository {
  findActorForUpdate(id: string): Promise<LocalBarcodeActorRecord | null>;
  findRecipientForUpdate(id: string): Promise<LocalBarcodeRecipientRecord | null>;
  findItemForUpdate(id: string): Promise<LocalBarcodeItemRecord | null>;
  findItem(id: string): Promise<LocalBarcodeItemRecord | null>;
  findGroupForUpdate(id: string): Promise<LocalBarcodeGroupRecord | null>;
  findGroup(id: string): Promise<LocalBarcodeGroupRecord | null>;
  findGroupByBarcodeKey(key: string): Promise<LocalBarcodeGroupRecord | null>;
  findGroupPhoto(groupId: string): Promise<LocalBarcodeStoredPhoto | null>;
  listGroups(itemId: string): Promise<LocalBarcodeGroupRecord[]>;
  listActiveGroupsAssignedTo(userId: string): Promise<LocalBarcodeGroupRecord[]>;
  listEvents(groupId: string): Promise<LocalBarcodeEventRecord[]>;
  allocatedQuantity(itemId: string): Promise<number>;
  isBarcodeRegistered(key: string): Promise<boolean>;
  advanceItemVersion(itemId: string, version: number): Promise<boolean>;
  nextSequence(): Promise<bigint>;
  insertGroup(input: InsertLocalBarcodeGroup): Promise<void>;
  reduceGroupQuantity(id: string, version: number, quantity: number): Promise<boolean>;
  increaseGroupQuantity(id: string, quantity: number): Promise<boolean>;
  transferWholeGroup(input: { id: string; version: number; responsibleUserId: string; roomId: string; transferredAt: Date }): Promise<boolean>;
  cancelGroup(input: { id: string; version: number; cancelledBy: string; cancelledAt: Date; reason: string }): Promise<boolean>;
  countActiveChildren(id: string): Promise<number>;
  insertEvent(input: { id: string; groupId: string; eventType: LocalBarcodeEventRecord["eventType"]; actorId: string; fromResponsibleUserId: string | null; toResponsibleUserId: string | null; quantity: number; roomId: string; reason: string | null; occurredAt: Date }): Promise<void>;
  appendAudit(input: { id: string; actorId: string; actorRole: UserRole; groupId: string; revision: number; action: string; beforeValues: Record<string, unknown> | null; afterValues: Record<string, unknown> | null; reason: string | null; administrative: boolean; occurredAt: Date }): Promise<void>;
}

export interface LocalBarcodeRepositories {
  idempotency: IdempotencyRequestRepository;
  localBarcodes: LocalBarcodeRepository;
}
