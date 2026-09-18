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
  primaryResponsible?: { id: string; name: string } | null;
  accessMode?: "open" | "closed";
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
  primaryResponsibleId?: string | null;
  accessMode?: "open" | "closed";
}

export interface UpdateRoomInput extends CreateRoomInput {
  version: number;
}

export interface UpdateRoomAccessInput {
  accessMode: "open" | "closed";
  version: number;
}

export interface BulkUpdateRoomAccessInput {
  rooms: Array<{ id: string; version: number }>;
  accessMode: "open" | "closed";
}

export interface BulkUpdateRoomAccessResult {
  results: Array<
    | { id: string; status: "updated" | "unchanged"; room: RoomDto }
    | { id: string; status: "failed"; error: string }
  >;
}
