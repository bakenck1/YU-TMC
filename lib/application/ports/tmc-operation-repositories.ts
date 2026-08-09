import type {
  ItemStatus,
  TmcTransferItemResult,
  TmcTransferRequestStatus,
} from "@/lib/contracts/inventory-domain";
import type { TmcOperationProblemCode } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";

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
  responsibilityPeriodIdAtRequest: string;
  currentResponsibleIdAtRequest: string;
  responsibleUserProfile: TmcOperationUserRecord;
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
  responsibilityPeriodIdAtRequest: string;
  currentResponsibleIdAtRequest: string;
  createdAt: Date;
}

export interface InsertedTmcTransferRequestItemRecord {
  id: string;
  requestId: string;
  itemId: string;
  responsibilityPeriodIdAtRequest: string;
  currentResponsibleIdAtRequest: string;
  result: TmcTransferItemResult;
  invalidReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  version: number;
}

export type TmcOperationRepositoryConflictProblem = Extract<
  TmcOperationProblemCode,
  "active_transfer_exists" | "responsibility_changed" | "duplicate_item"
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
  insertRequest(input: InsertTmcTransferRequestRecord): Promise<void>;
  insertRequestItem(
    input: InsertTmcTransferRequestItemRecord,
  ): Promise<InsertedTmcTransferRequestItemRecord>;
}

export interface TmcOperationRepositories {
  transferRequests: TmcTransferRequestRepository;
}
