import type {
  ServiceRequestStatus,
  ServiceRequestType,
} from "@/lib/contracts/inventory-domain";
import type { ServiceRequestFilters } from "@/lib/contracts/service-requests";
import type { UserRole } from "@/lib/contracts/users";

export interface ServiceRequestRecord {
  id: string;
  itemId: string;
  itemName: string;
  inventoryNumber: string;
  roomId: string;
  roomDesignation: string;
  buildingName: string;
  authorId: string;
  authorName: string;
  responsibleId: string | null;
  responsibleName: string | null;
  roomResponsibleId: string | null;
  itemResponsibleId: string | null;
  type: ServiceRequestType;
  description: string;
  status: ServiceRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface InsertServiceRequestRecord {
  id: string;
  itemId: string;
  roomId: string;
  authorId: string;
  type: ServiceRequestType;
  description: string;
  photoBytes: Uint8Array;
  photoWidth: number;
  photoHeight: number;
  occurredAt: Date;
}

export interface ServiceRequestPhotoRecord {
  bytes: Uint8Array;
  mediaType: "image/jpeg";
}

export interface ServiceRequestAuthorizationActor {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export interface ServiceRequestAuthorizationUser {
  id: string;
  role: UserRole;
  active: boolean;
  deletedAt: Date | null;
  version: number;
}

export interface ServiceRequestItemContext {
  roomId: string;
  roomResponsibleId: string | null;
  itemResponsibleId: string | null;
}

export interface ServiceRequestRepository {
  list(
    filters: ServiceRequestFilters,
    actor: ServiceRequestAuthorizationActor,
  ): Promise<ServiceRequestRecord[]>;
  findById(id: string): Promise<ServiceRequestRecord | null>;
  findByIdForUpdate(id: string): Promise<ServiceRequestRecord | null>;
  findAuthorizationUserForUpdate(
    userId: string,
  ): Promise<ServiceRequestAuthorizationUser | null>;
  findItemContext(itemId: string): Promise<ServiceRequestItemContext | null>;
  findCreateAuthorizationForUpdate(
    itemId: string,
    actorId: string,
  ): Promise<{
    actor: ServiceRequestAuthorizationUser | null;
    item: ServiceRequestItemContext | null;
  }>;
  insert(input: InsertServiceRequestRecord): Promise<ServiceRequestRecord>;
  updateStatus(input: {
    id: string;
    status: ServiceRequestStatus;
    expectedStatus: ServiceRequestStatus;
    actorId: string;
    actorRole: UserRole;
    actorSessionVersion: number;
    expectedVersion: number;
    occurredAt: Date;
  }): Promise<ServiceRequestRecord | null>;
  findPhoto(id: string): Promise<ServiceRequestPhotoRecord | null>;
  appendAudit(input: {
    id: string;
    actorId: string;
    actorRole: UserRole;
    subjectId: string;
    subjectRevision: number;
    action: string;
    beforeValues: Record<string, unknown> | null;
    afterValues: Record<string, unknown> | null;
    occurredAt: Date;
  }): Promise<void>;
}

export interface ServiceRequestRepositories {
  requests: ServiceRequestRepository;
}
