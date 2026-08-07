import type {
  ServiceRequestStatus,
  ServiceRequestType,
} from "@/lib/contracts/inventory-domain";

export interface ServiceRequestDto {
  id: string;
  item: { id: string; name: string; inventoryNumber: string };
  room: { id: string; designation: string; buildingName: string };
  author: { id: string; name: string };
  responsible: { id: string; name: string } | null;
  type: ServiceRequestType;
  description: string;
  status: ServiceRequestStatus;
  photoUrl: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateServiceRequestInput {
  itemId: string;
  type: ServiceRequestType;
  description: string;
  photo: { imageDataUrl: string; width: number; height: number };
}

export interface ServiceRequestFilters {
  status?: ServiceRequestStatus;
  roomId?: string;
  employeeId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}
