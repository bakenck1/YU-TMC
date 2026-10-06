import type {
  ConnectionStatus,
  ItemCondition,
  ItemStatus,
} from "@/lib/contracts/inventory-domain";

export interface RoomWorkspaceRecord {
  passport?: import("@/lib/contracts/room-passports").PassportFileDto | null;
  id: string;
  designation: string;
  buildingName: string;
  floorNumber: number;
  floorLabel: string | null;
  primaryResponsibleId: string | null;
  primaryResponsibleName: string | null;
  accessMode: "open" | "closed";
}

export interface RoomWorkspaceItemRecord {
  id: string;
  name: string;
  inventoryNumber: string;
  description: string | null;
  status: ItemStatus;
  condition: ItemCondition;
  connectionStatus: ConnectionStatus;
  responsibleName: string | null;
  responsibleUserId: string | null;
  hasPhoto: boolean;
  /** The original inventory item owns photos for a local barcode group. */
  photoItemId?: string;
  createdAt: Date;
  href?: string;
}

export interface RoomWorkspaceRepository {
  findRoomById(id: string): Promise<RoomWorkspaceRecord | null>;
  findRoomByQr(canonicalKey: string): Promise<RoomWorkspaceRecord | null>;
  listRoomItems(roomId: string): Promise<RoomWorkspaceItemRecord[]>;
}

export interface RoomWorkspaceRepositories {
  rooms: RoomWorkspaceRepository;
}
