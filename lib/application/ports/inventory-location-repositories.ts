export interface BuildingRecord {
  id: string;
  name: string;
  nameKey: string;
  address: string;
  addressKey: string;
  qrCode: string;
  roomCount: number;
  status: "active" | "archived";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertBuildingRecord {
  id: string;
  name: string;
  nameKey: string;
  address: string;
  addressKey: string;
  actorId: string;
  occurredAt: Date;
}

export interface UpdateBuildingRecord {
  id: string;
  name: string;
  nameKey: string;
  address: string;
  addressKey: string;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface ArchiveBuildingRecord {
  id: string;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface InsertBuildingQrRecord {
  id: string;
  buildingId: string;
  value: string;
  actorId: string;
}

export interface AppendLocationAuditRecord {
  id: string;
  actorId: string;
  actorRole: "admin" | "warehouse";
  subjectKind: "building" | "room" | "qr_identifier";
  subjectId: string;
  subjectRevision: number;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  occurredAt: Date;
}

export interface RoomRecord {
  id: string;
  buildingId: string;
  designation: string;
  designationKey: string;
  floorNumber: number;
  floorLabel: string | null;
  primaryResponsibleId: string | null;
  primaryResponsibleName: string | null;
  qrCode: string;
  status: "active" | "archived";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertRoomRecord {
  id: string;
  buildingId: string;
  designation: string;
  designationKey: string;
  floorNumber: number;
  floorLabel: string | null;
  primaryResponsibleId: string | null;
  actorId: string;
  occurredAt: Date;
}

export interface UpdateRoomRecord extends Omit<InsertRoomRecord, "buildingId"> {
  expectedVersion: number;
}

export interface ArchiveRoomRecord {
  id: string;
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
}

export interface InsertRoomQrRecord {
  id: string;
  roomId: string;
  value: string;
  actorId: string;
}

export interface InventoryLocationRepository {
  listBuildings(): Promise<BuildingRecord[]>;
  findBuildingById(id: string): Promise<BuildingRecord | null>;
  findBuildingByIdForUpdate(id: string): Promise<BuildingRecord | null>;
  insertBuilding(input: InsertBuildingRecord): Promise<BuildingRecord>;
  updateBuilding(input: UpdateBuildingRecord): Promise<BuildingRecord | null>;
  archiveBuilding(input: ArchiveBuildingRecord): Promise<BuildingRecord | null>;
  countActiveRooms(buildingId: string): Promise<number>;
  insertBuildingQr(input: InsertBuildingQrRecord): Promise<void>;
  appendAudit(input: AppendLocationAuditRecord): Promise<void>;
  listRooms(buildingId: string): Promise<RoomRecord[]>;
  findRoomById(id: string): Promise<RoomRecord | null>;
  findRoomByIdForUpdate(id: string): Promise<RoomRecord | null>;
  insertRoom(input: InsertRoomRecord): Promise<RoomRecord>;
  updateRoom(input: UpdateRoomRecord): Promise<RoomRecord | null>;
  archiveRoom(input: ArchiveRoomRecord): Promise<RoomRecord | null>;
  countActiveItems(roomId: string): Promise<number>;
  insertRoomQr(input: InsertRoomQrRecord): Promise<void>;
}

export interface InventoryLocationRepositories {
  locations: InventoryLocationRepository;
}
