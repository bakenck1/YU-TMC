import type {
  ConnectionStatus,
  ItemCondition,
  ItemStatus,
} from "@/lib/contracts/inventory-domain";

export interface PublicRoomDto {
  access: "authentication_required";
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
  href: string;
}

export interface VisibleRoomWorkspaceDto {
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

export interface DeniedRoomWorkspaceDto {
  access: "denied";
  items: [];
}

export type RoomWorkspaceDto = VisibleRoomWorkspaceDto | DeniedRoomWorkspaceDto;
