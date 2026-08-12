import type {
  ItemStatus,
  TmcTransferItemResult,
  TmcTransferRequestStatus,
} from "@/lib/contracts/inventory-domain";
import type { TmcOperationProblemCode } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import type { IdempotencyRequestRepository } from "@/lib/application/ports/inventory-concurrency-repositories";
import type { NotificationEventType } from "@/lib/contracts/inventory-domain";

export interface TmcOperationUserRecord {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

export interface TmcTransferUserRecord
  extends TmcOperationUserRecord {
  active: boolean;
  deletedAt: Date | null;
}

export interface TmcTransferCandidateRecord {
  itemId: string;
  itemVersion: number;
  itemStatus: ItemStatus;
  archivedAt: Date | null;
  name: string;
  inventoryNumber: string;
  quantity: number;
  unitPrice: number;
  photoUrl: string | null;
  buildingId: string;
  buildingName: string;
  roomId: string;
  roomDesignation: string;
  responsibilityPeriodId: string | null;
  responsibleUser: TmcTransferUserRecord | null;
  hasActiveTransfer: boolean;
}

export interface TmcTransferItemCardRecord {
  id: string;
  version: number;
  name: string;
  inventoryNumber: string;
  quantity: number;
  unitPrice: number;
  photoUrl: string | null;
  buildingId: string;
  buildingName: string;
  roomId: string;
  roomDesignation: string;
}

export interface TmcTransferRequestItemRecord {
  id: string;
  requestId: string;
  itemId: string;
  item: TmcTransferItemCardRecord;
  responsibilityPeriodIdAtRequest: string | null;
  currentResponsibleIdAtRequest: string | null;
  responsibleUserProfile: TmcOperationUserRecord | null;
  result: TmcTransferItemResult;
  invalidReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: TmcOperationUserRecord | null;
  version: number;
}

export interface TmcTransferRequestRecord {
  id: string;
  initiator: TmcOperationUserRecord;
  recipient: TmcOperationUserRecord;
  status: TmcTransferRequestStatus;
  comment: string | null;
  createdAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
  closedBy: TmcOperationUserRecord | null;
  isAdministrativeDecision: boolean;
  administrativeReason: string | null;
  version: number;
  items: TmcTransferRequestItemRecord[];
}

export interface InsertTmcTransferRequestRecord {
  id: string;
  initiatorId: string;
  recipientId: string;
  comment: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface InsertTmcTransferRequestItemRecord {
  id: string;
  requestId: string;
  itemId: string;
  expectedItemVersion: number;
  responsibilityPeriodIdAtRequest: string | null;
  currentResponsibleIdAtRequest: string | null;
  createdAt: Date;
}

export interface InsertedTmcTransferRequestItemRecord {
  id: string;
  requestId: string;
  itemId: string;
  responsibilityPeriodIdAtRequest: string | null;
  currentResponsibleIdAtRequest: string | null;
  result: TmcTransferItemResult;
  invalidReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  version: number;
}

export interface DecideTmcTransferRequestItemRecord {
  requestId: string;
  requestItemId: string;
  itemId: string;
  responsibilityPeriodIdAtRequest: string | null;
  currentResponsibleIdAtRequest: string | null;
  expectedVersion: number;
  decision: "accept" | "reject";
  recipientId: string;
  decidedBy: string;
  decidedAt: Date;
  newResponsibilityPeriodId: string;
  responsibilitySource?: "transfer" | "admin_override";
}

export interface CloseTmcTransferRequestRecord {
  requestId: string;
  expectedVersion: number;
  status: "accepted" | "rejected";
  closedBy: string;
  closedAt: Date;
  isAdministrativeDecision: boolean;
  administrativeReason: string | null;
}

export interface CancelTmcTransferRequestRecord {
  requestId: string;
  expectedVersion: number;
  cancelledBy: string;
  cancelledAt: Date;
  isAdministrativeDecision: boolean;
  administrativeReason: string | null;
}

export interface TmcTransferHistoryQuery {
  actorId: string;
  includeAll: boolean;
  status?: TmcTransferRequestStatus;
  createdFrom?: Date;
  createdTo?: Date;
  initiatorId?: string;
  recipientId?: string;
  buildingId?: string;
  roomId?: string;
  itemId?: string;
  overdue?: boolean;
  now: Date;
  limit: number;
  requestCursorCreatedAt?: Date;
  requestCursorId?: string;
  locationCursorOccurredAt?: Date;
  locationCursorId?: string;
}

export interface TmcLocationHistoryRecord {
  id: string;
  itemId: string;
  itemName: string;
  inventoryNumber: string;
  actorId: string | null;
  actorName: string | null;
  beforeRoomId: string;
  beforeLocation: string;
  afterRoomId: string;
  afterLocation: string;
  comment: string | null;
  occurredAt: Date;
}

export interface AppendTmcAuditRecord {
  id: string;
  domainEventId: string;
  actorId: string;
  actorRole: UserRole;
  subjectKind: "tmc_transfer_request" | "item";
  subjectId: string;
  subjectRevision: number;
  action: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  occurredAt: Date;
}

export interface CreateTmcNotificationRecord {
  id: string;
  domainEventId: string;
  type: Extract<NotificationEventType, `tmc_transfer.${string}`>;
  actorId: string | null;
  requestId: string;
  itemId: string | null;
  requestRevision: number;
  recipientId?: string;
  audience: "direct_user" | "admin_queue";
  safePayload: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}

export interface TmcNotificationRecord {
  id: string;
  type: Extract<NotificationEventType, `tmc_transfer.${string}`>;
  requestId: string;
  itemId: string | null;
  safePayload: Record<string, string | number | boolean | null>;
  occurredAt: Date;
  readAt: Date | null;
}

export interface TmcStageFourRepository {
  listHistory(input: TmcTransferHistoryQuery): Promise<TmcTransferRequestRecord[]>;
  listLocationHistory(input: TmcTransferHistoryQuery): Promise<TmcLocationHistoryRecord[]>;
  appendAudit(input: AppendTmcAuditRecord): Promise<void>;
  createNotification(input: CreateTmcNotificationRecord): Promise<void>;
  listNotifications(input: {
    actorId: string;
    includeAdminQueue: boolean;
    now: Date;
    limit: number;
  }): Promise<TmcNotificationRecord[]>;
  countUnreadNotifications(input: {
    actorId: string;
    includeAdminQueue: boolean;
    now: Date;
  }): Promise<number>;
  markNotificationRead(input: {
    notificationId: string;
    actorId: string;
    includeAdminQueue: boolean;
    readAt: Date;
  }): Promise<boolean>;
}

export type TmcOperationRepositoryConflictProblem = Extract<
  TmcOperationProblemCode,
  | "item_not_found"
  | "item_inactive"
  | "active_transfer_exists"
  | "responsibility_changed"
  | "version_conflict"
  | "duplicate_item"
>;

export class TmcOperationRepositoryConflictError extends Error {
  readonly cause: unknown;

  constructor(
    readonly problem: TmcOperationRepositoryConflictProblem,
    cause: unknown,
  ) {
    super(problem);
    this.name = "TmcOperationRepositoryConflictError";
    this.cause = cause;
  }
}

export interface TmcTransferRequestRepository {
  findUserById(id: string): Promise<TmcTransferUserRecord | null>;
  findCandidates(
    itemIds: readonly string[],
  ): Promise<TmcTransferCandidateRecord[]>;
  findById(id: string): Promise<TmcTransferRequestRecord | null>;
  findByIdForUpdate(id: string): Promise<TmcTransferRequestRecord | null>;
  findItemPhoto(
    requestId: string,
    itemId: string,
  ): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg" } | null>;
  decideItem(
    input: DecideTmcTransferRequestItemRecord,
  ): Promise<"accepted" | "rejected" | "invalidated">;
  closeRequest(input: CloseTmcTransferRequestRecord): Promise<boolean>;
  cancelRequest(input: CancelTmcTransferRequestRecord): Promise<boolean>;
  insertRequest(input: InsertTmcTransferRequestRecord): Promise<void>;
  insertRequestItem(
    input: InsertTmcTransferRequestItemRecord,
  ): Promise<InsertedTmcTransferRequestItemRecord>;
}

export interface TmcOperationRepositories {
  idempotency: IdempotencyRequestRepository;
  transferRequests: TmcTransferRequestRepository;
  stageFour: TmcStageFourRepository;
}
