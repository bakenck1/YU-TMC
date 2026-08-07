import type {
  ConnectionStatus,
  ItemCondition,
  ItemStatus,
} from "@/lib/contracts/inventory-domain";

export interface RoomWorkspaceRecord {
  id: string;
  designation: string;
  buildingName: string;
  floorNumber: number;
  floorLabel: string | null;
  primaryResponsibleId: string | null;
  primaryResponsibleName: string | null;
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
  hasPhoto: boolean;
  createdAt: Date;
}

export interface RoomWorkspaceRepository {
  findRoomById(id: string): Promise<RoomWorkspaceRecord | null>;
  findRoomByQr(canonicalKey: string): Promise<RoomWorkspaceRecord | null>;
  listRoomItems(roomId: string): Promise<RoomWorkspaceItemRecord[]>;
}

export interface RoomWorkspaceRepositories {
  rooms: RoomWorkspaceRepository;
}
