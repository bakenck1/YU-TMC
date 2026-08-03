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
  deadlineAt: string;
  rooms: InspectionRoomDto[];
  items: InspectionExpectedItemDto[];
  results: ItemResultDto[];
  progress: {
    checked: number;
    total: number;
    percent: number;
    present: number;
    missing: number;
    unchecked: number;
    comments: number;
  };
  displayStatus: "draft" | "in_progress" | "completed" | "overdue";
}

export interface InspectionExpectedItemDto {
  inspectionRoomId: string;
  itemId: string;
  itemName: string;
  inventoryNumber: string;
  buildingName: string;
  roomDesignation: string;
}

export interface CreateInspectionInput {
  name: string;
  technicianId?: string;
  deadlineAt?: string;
}

export interface AddInspectionRoomInput {
  buildingId: string;
  roomId: string;
}
