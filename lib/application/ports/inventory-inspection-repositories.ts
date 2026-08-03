import type {
  InventoryNumberKind,
  InspectionStatus,
  ItemResultValue,
} from "@/lib/contracts/inventory-domain";
import type { UserRole } from "@/lib/contracts/users";

export interface InspectionRecord {
  id: string;
  name: string;
  technicianId: string;
  status: InspectionStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deadlineAt: Date;
}

export interface AssignableTechnicianRecord {
  id: string;
  role: "warehouse" | "employee";
}

export interface InspectionRoomRecord {
  id: string;
  inspectionId: string;
  buildingId: string;
  roomId: string;
  buildingName: string;
  buildingAddress: string;
  roomDesignation: string;
  floorNumber: number;
  floorLabel: string | null;
  addedAt: Date;
  inspectedAt: Date | null;
}

export interface RoomSnapshot {
  buildingId: string;
  roomId: string;
  buildingName: string;
  buildingAddress: string;
  roomDesignation: string;
  floorNumber: number;
  floorLabel: string | null;
}

export interface ItemSnapshotAtScan {
  itemId: string;
  registryRoomId: string;
  responsibleUserId: string | null;
  itemName: string;
  inventoryNumberKind: InventoryNumberKind;
  inventoryNumber: string;
  buildingName: string;
  roomDesignation: string;
}

export interface InspectionExpectedItemRecord extends ItemSnapshotAtScan {
  inspectionRoomId: string;
}

export interface ItemResultRecord {
  id: string;
  inspectionId: string;
  inspectionRoomId: string;
  itemId: string;
  registryRoomIdAtScan: string;
  responsibleIdAtScan: string | null;
  itemNameSnapshot: string;
  inventoryNumberSnapshot: string;
  result: ItemResultValue;
  comment: string | null;
  revisionNumber: number;
  createdAt: Date;
}

export interface InsertItemResultRecord {
  id: string;
  inspectionId: string;
  inspectionRoomId: string;
  snapshot: ItemSnapshotAtScan;
  createdBy: string;
  createdAt: Date;
}

export interface InsertItemResultRevisionRecord {
  resultId: string;
  revisionNumber: number;
  inspectionRoomId: string;
  observedRoomId: string;
  result: ItemResultValue;
  comment: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface InsertInspectionRecord {
  id: string;
  name: string;
  technicianId: string;
  createdBy: string;
  createdAt: Date;
  deadlineAt: Date;
}

export interface InsertInspectionRoomRecord {
  id: string;
  inspectionId: string;
  snapshot: RoomSnapshot;
  addedBy: string;
  addedAt: Date;
}

export interface AppendInspectionAuditRecord {
  id: string;
  actorId: string;
  actorRole: UserRole;
  subjectKind: "inspection" | "item_result";
  subjectId: string;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  occurredAt: Date;
}

export interface InventoryInspectionRepository {
  listInspections(technicianId?: string): Promise<InspectionRecord[]>;
  findInspection(id: string): Promise<InspectionRecord | null>;
  findAssignableTechnician(
    id: string,
  ): Promise<AssignableTechnicianRecord | null>;
  listRooms(inspectionId: string): Promise<InspectionRoomRecord[]>;
  findInspectionRoom(
    inspectionId: string,
    inspectionRoomId: string,
  ): Promise<InspectionRoomRecord | null>;
  findItemSnapshot(itemId: string): Promise<ItemSnapshotAtScan | null>;
  findItemResult(
    inspectionId: string,
    itemId: string,
  ): Promise<ItemResultRecord | null>;
  listItemResults(inspectionId: string): Promise<ItemResultRecord[]>;
  listExpectedItems(inspectionId: string): Promise<InspectionExpectedItemRecord[]>;
  findExpectedItem(
    inspectionRoomId: string,
    itemId: string,
  ): Promise<ItemSnapshotAtScan | null>;
  findActiveRoomSnapshot(
    buildingId: string,
    roomId: string,
  ): Promise<RoomSnapshot | null>;
  insertInspection(input: InsertInspectionRecord): Promise<InspectionRecord>;
  insertInspectionRoom(input: InsertInspectionRoomRecord): Promise<InspectionRoomRecord>;
  snapshotRoomItems(
    inspectionRoomId: string,
    roomId: string,
    capturedAt: Date,
  ): Promise<void>;
  insertItemResult(input: InsertItemResultRecord): Promise<ItemResultRecord>;
  insertItemResultRevision(input: InsertItemResultRevisionRecord): Promise<void>;
  markInspectionRoomCompletedIfReady(
    inspectionRoomId: string,
    inspectedBy: string,
    inspectedAt: Date,
  ): Promise<void>;
  completeInspectionIfReady(inspectionId: string, completedAt: Date): Promise<boolean>;
  appendAudit(input: AppendInspectionAuditRecord): Promise<void>;
}

export interface InventoryInspectionRepositories {
  inspections: InventoryInspectionRepository;
}
