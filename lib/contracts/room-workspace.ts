import type {
  ConnectionStatus,
  ItemCondition,
  ItemStatus,
} from "@/lib/contracts/inventory-domain";

export interface PublicRoomDto {
  designation: string;
}

export interface RoomWorkspaceItemDto {
  id: string;
  name: string;
  inventoryNumber: string;
  description: string | null;
  status: ItemStatus;
  condition: ItemCondition;
  connectionStatus: ConnectionStatus;
  responsibleName: string | null;
  photoUrl: string | null;
  createdAt: string;
}

export interface RoomWorkspaceDto {
  access: "full" | "limited";
  id: string;
  designation: string;
  buildingName?: string;
  floorNumber?: number;
  floorLabel?: string | null;
  responsibleName: string | null;
  itemCount?: number;
  connectedCount?: number;
  disconnectedCount?: number;
  items: RoomWorkspaceItemDto[];
}
