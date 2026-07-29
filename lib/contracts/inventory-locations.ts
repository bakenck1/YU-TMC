export interface BuildingDto {
  id: string;
  name: string;
  address: string;
  qrCode: string;
  roomCount: number;
  status: "active" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuildingInput {
  name: string;
  address: string;
}

export interface UpdateBuildingInput {
  name: string;
  address: string;
  version: number;
}

export interface ArchiveLocationInput {
  version: number;
}

export interface RoomDto {
  id: string;
  buildingId: string;
  designation: string;
  floorNumber: number;
  floorLabel: string | null;
  qrCode: string;
  status: "active" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoomInput {
  designation: string;
  floorNumber: number;
  floorLabel?: string | null;
}

export interface UpdateRoomInput extends CreateRoomInput {
  version: number;
}
