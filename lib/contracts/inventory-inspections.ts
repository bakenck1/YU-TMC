import type { InspectionStatus } from "@/lib/contracts/inventory-domain";
import type { ItemResultDto } from "@/lib/contracts/inventory-inspection-results";

export interface InspectionRoomDto {
  id: string;
  buildingId: string;
  roomId: string;
  buildingName: string;
  buildingAddress: string;
  roomDesignation: string;
  floorNumber: number;
  floorLabel: string | null;
  addedAt: string;
  inspectedAt: string | null;
}

export interface InspectionDto {
  id: string;
  name: string;
  technicianId: string;
  status: InspectionStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  rooms: InspectionRoomDto[];
  results: ItemResultDto[];
}

export interface CreateInspectionInput {
  name: string;
}

export interface AddInspectionRoomInput {
  buildingId: string;
  roomId: string;
}
