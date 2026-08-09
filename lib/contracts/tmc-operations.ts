import type {
  TmcTransferItemResult,
  TmcTransferRequestStatus,
} from "@/lib/contracts/inventory-domain";
import type { UserRole } from "@/lib/contracts/users";

export type {
  TmcTransferItemResult,
  TmcTransferRequestStatus,
} from "@/lib/contracts/inventory-domain";

export const TMC_OPERATION_PROBLEM_CODES = [
  "item_not_found",
  "item_inactive",
  "forbidden",
  "already_responsible",
  "active_transfer_exists",
  "responsibility_changed",
  "version_conflict",
  "duplicate_item",
  "room_not_found",
  "room_inactive",
] as const;
export type TmcOperationProblemCode =
  (typeof TMC_OPERATION_PROBLEM_CODES)[number];

export interface TmcOperationUserDto {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
}

export interface TmcTransferItemSnapshotDto {
  id: string;
  name: string;
  inventoryNumber: string;
  quantity: number;
  unitPrice: number;
  photoUrl: string | null;
  location: {
    buildingId: string;
    buildingName: string;
    roomId: string;
    roomDesignation: string;
  };
}

export type TmcTransferRequestItemState =
  | {
      result: "pending";
      invalidReason: null;
      decidedAt: null;
      decidedBy: null;
    }
  | {
      result: Exclude<TmcTransferItemResult, "pending" | "invalidated">;
      invalidReason: null;
      decidedAt: string;
      decidedBy: TmcOperationUserDto;
    }
  | {
      result: "invalidated";
      invalidReason: string;
      decidedAt: string;
      decidedBy: TmcOperationUserDto;
    };

export interface TmcTransferRequestItemBaseDto {
  id: string;
  requestId: string;
  item: TmcTransferItemSnapshotDto;
  responsibilityPeriodIdAtRequest: string;
  currentResponsibleIdAtRequest: string;
  currentResponsibleAtRequest: TmcOperationUserDto;
  createdAt: string;
  version: number;
}

export type TmcTransferRequestItemDto =
  TmcTransferRequestItemBaseDto & TmcTransferRequestItemState;

type TmcTerminalRequestStatus = Exclude<
  TmcTransferRequestStatus,
  "pending"
>;

export type TmcTransferRequestState =
  | {
      status: "pending";
      closedAt: null;
      closedBy: null;
      isAdministrativeDecision: false;
      administrativeReason: null;
    }
  | {
      status: TmcTerminalRequestStatus;
      closedAt: string;
      closedBy: TmcOperationUserDto;
      isAdministrativeDecision: false;
      administrativeReason: null;
    }
  | {
      status: TmcTerminalRequestStatus;
      closedAt: string;
      closedBy: TmcOperationUserDto;
      isAdministrativeDecision: true;
      administrativeReason: string;
    };

export interface TmcTransferRequestSummaryDto {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  cancelled: number;
  invalidated: number;
}

export interface TmcTransferRequestBaseDto {
  id: string;
  initiator: TmcOperationUserDto;
  recipient: TmcOperationUserDto;
  comment: string | null;
  createdAt: string;
  expiresAt: string;
  overdue: boolean;
  version: number;
  summary: TmcTransferRequestSummaryDto;
  items: TmcTransferRequestItemDto[];
}

export type TmcTransferRequestDto =
  TmcTransferRequestBaseDto & TmcTransferRequestState;

export interface CreateTmcTransferRequestInput {
  recipientId: string;
  itemIds: readonly string[];
  comment?: string | null;
}

export interface TmcTransferItemDecision {
  itemId: string;
  itemVersion: number;
  decision: "accept" | "reject";
}

export interface TmcOperationItemReference {
  itemId: string;
  itemVersion: number;
}

export type AcceptUnassignedTmcInput = TmcOperationItemReference;

export interface BulkChangeTmcLocationInput {
  items: readonly TmcOperationItemReference[];
  roomId: string;
  comment?: string | null;
}

export interface TmcOperationSuccessItemOutcomeDto {
  itemId: string;
  outcome: "success";
  itemVersion: number;
}

export interface TmcOperationProblemItemOutcomeDto {
  itemId: string;
  outcome: "problem";
  problem: TmcOperationProblemCode;
}

export type TmcOperationItemOutcomeDto =
  | TmcOperationSuccessItemOutcomeDto
  | TmcOperationProblemItemOutcomeDto;

export interface TmcTransferRequestIncludedItemOutcomeDto {
  itemId: string;
  outcome: "included";
  requestItemId: string;
  requestItemVersion: number;
}

export type TmcTransferRequestCreationItemOutcomeDto =
  | TmcTransferRequestIncludedItemOutcomeDto
  | TmcOperationProblemItemOutcomeDto;

interface CreatedTmcTransferRequestResultDto {
  request: TmcTransferRequestDto;
  total: number;
  included: number;
  problems: number;
  items: TmcTransferRequestCreationItemOutcomeDto[];
}

interface RejectedTmcTransferRequestResultDto {
  request: null;
  total: number;
  included: 0;
  problems: number;
  items: TmcOperationProblemItemOutcomeDto[];
}

export type CreateTmcTransferRequestResultDto =
  | CreatedTmcTransferRequestResultDto
  | RejectedTmcTransferRequestResultDto;

export interface TmcBulkOperationResultDto {
  total: number;
  succeeded: number;
  problems: number;
  items: TmcOperationItemOutcomeDto[];
}

export interface DecideTmcTransferRequestInput {
  requestVersion: number;
  decisions: readonly TmcTransferItemDecision[];
  /** Used only when server-side authorization identifies an admin override. */
  administrativeReason?: string | null;
}

export interface CancelTmcTransferRequestInput {
  requestVersion: number;
  /** Used only when server-side authorization identifies an admin override. */
  administrativeReason?: string | null;
}
