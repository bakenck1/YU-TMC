import { z } from "zod";

import {
  TMC_TRANSFER_ITEM_RESULTS,
  TMC_TRANSFER_REQUEST_STATUSES,
  type TmcTransferItemResult,
  type TmcTransferRequestStatus,
} from "@/lib/contracts/inventory-domain";
import {
  USER_ROLES,
  type UserRole,
} from "@/lib/contracts/users";
export type {
  TmcTransferItemResult,
  TmcTransferRequestStatus,
} from "@/lib/contracts/inventory-domain";

export const TMC_OPERATION_PROBLEM_CODES = [
  "item_not_found",
  "item_inactive",
  "item_unassigned",
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

export interface TmcTransferItemCardDto {
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
      result: "accepted" | "rejected";
      invalidReason: null;
      decidedAt: string;
      decidedBy: TmcOperationUserDto;
    }
  | {
      // When a request is cancelled while items are still pending, the database
      // does not set decidedAt/decidedBy on the item rows — the decision was
      // at the request level. Both fields may therefore be null.
      result: "cancelled";
      invalidReason: null;
      decidedAt: string | null;
      decidedBy: TmcOperationUserDto | null;
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
  item: TmcTransferItemCardDto;
  responsibilityPeriodIdAtRequest: string | null;
  currentResponsibleIdAtRequest: string | null;
  /** Current profile of the user captured by currentResponsibleIdAtRequest. */
  responsibleUserProfile: TmcOperationUserDto | null;
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

export interface CancelTmcTransferRequestInput {
  requestVersion: number;
  administrativeReason?: string | null;
}

export interface TmcTransferHistoryFilters {
  status?: TmcTransferRequestStatus;
  createdFrom?: string;
  createdTo?: string;
  initiatorId?: string;
  recipientId?: string;
  buildingId?: string;
  roomId?: string;
  itemId?: string;
  overdue?: boolean;
  limit?: number;
  requestCursor?: string;
  locationCursor?: string;
}

export interface TmcTransferHistoryDto {
  requests: TmcTransferRequestDto[];
  locationChanges: TmcLocationHistoryDto[];
  nextRequestCursor: string | null;
  nextLocationCursor: string | null;
}

export interface TmcLocationHistoryDto {
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
  occurredAt: string;
}

export interface TmcNotificationDto {
  id: string;
  type:
    | "tmc_transfer.requested"
    | "tmc_transfer.completed"
    | "tmc_transfer.cancelled"
    | "tmc_transfer.problem"
    | "tmc_transfer.overdue";
  requestId: string;
  itemId: string | null;
  safePayload: Record<string, string | number | boolean | null>;
  occurredAt: string;
  readAt: string | null;
}

export interface TmcNotificationFeedDto {
  notifications: TmcNotificationDto[];
  unreadCount: number;
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

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().refine(
  (value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  },
  { message: "Expected a canonical ISO timestamp." },
);
const operationUserSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
}).strict();
const itemCardSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  inventoryNumber: z.string(),
  quantity: z.number().finite(),
  unitPrice: z.number().finite(),
  photoUrl: z.string().nullable(),
  location: z.object({
    buildingId: uuidSchema,
    buildingName: z.string(),
    roomId: uuidSchema,
    roomDesignation: z.string(),
  }).strict(),
}).strict();
const requestItemSchema = z.object({
  id: uuidSchema,
  requestId: uuidSchema,
  item: itemCardSchema,
  responsibilityPeriodIdAtRequest: uuidSchema.nullable(),
  currentResponsibleIdAtRequest: uuidSchema.nullable(),
  responsibleUserProfile: operationUserSchema.nullable(),
  result: z.enum(TMC_TRANSFER_ITEM_RESULTS),
  invalidReason: z.string().nullable(),
  createdAt: timestampSchema,
  decidedAt: timestampSchema.nullable(),
  decidedBy: operationUserSchema.nullable(),
  version: z.number().int().positive(),
}).strict().superRefine((item, context) => {
  const hasNoResponsibleSnapshot =
    item.responsibilityPeriodIdAtRequest === null &&
    item.currentResponsibleIdAtRequest === null &&
    item.responsibleUserProfile === null;
  const hasCompleteResponsibleSnapshot =
    item.responsibilityPeriodIdAtRequest !== null &&
    item.currentResponsibleIdAtRequest !== null &&
    item.responsibleUserProfile !== null;
  if (!hasNoResponsibleSnapshot && !hasCompleteResponsibleSnapshot) {
    context.addIssue({
      code: "custom",
      message: "Incomplete responsibility snapshot.",
    });
  }
  if (item.result === "pending") {
    if (item.invalidReason || item.decidedAt || item.decidedBy) {
      context.addIssue({ code: "custom", message: "Invalid pending item state." });
    }
    return;
  }
  // Cancelled items: decidedAt/decidedBy may be null when the request was
  // cancelled before individual item decisions were recorded.
  if (item.result === "cancelled") {
    if (item.invalidReason !== null) {
      context.addIssue({ code: "custom", message: "Cancelled item must not have invalidReason." });
    }
    return;
  }
  if (!item.decidedAt || !item.decidedBy) {
    context.addIssue({ code: "custom", message: "Incomplete terminal item state." });
  }
  if (item.result === "invalidated" ? !item.invalidReason : item.invalidReason !== null) {
    context.addIssue({ code: "custom", message: "Invalid item reason state." });
  }
});
const summarySchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  invalidated: z.number().int().nonnegative(),
}).strict();
const requestSchema = z.object({
  id: uuidSchema,
  initiator: operationUserSchema,
  recipient: operationUserSchema,
  status: z.enum(TMC_TRANSFER_REQUEST_STATUSES),
  comment: z.string().nullable(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  overdue: z.boolean(),
  closedAt: timestampSchema.nullable(),
  closedBy: operationUserSchema.nullable(),
  isAdministrativeDecision: z.boolean(),
  administrativeReason: z.string().nullable(),
  version: z.number().int().positive(),
  summary: summarySchema,
  items: z.array(requestItemSchema),
}).strict().superRefine((request, context) => {
  const counts = {
    pending: 0,
    accepted: 0,
    rejected: 0,
    cancelled: 0,
    invalidated: 0,
  };
  for (const item of request.items) {
    counts[item.result] += 1;
    if (item.requestId !== request.id) {
      context.addIssue({ code: "custom", message: "Request item scope mismatch." });
    }
  }
  if (
    request.summary.total !== request.items.length ||
    Object.entries(counts).some(([state, count]) =>
      request.summary[state as keyof typeof counts] !== count)
  ) {
    context.addIssue({ code: "custom", message: "Request summary mismatch." });
  }
  if (request.status === "pending") {
    if (
      request.closedAt || request.closedBy ||
      request.isAdministrativeDecision || request.administrativeReason
    ) {
      context.addIssue({ code: "custom", message: "Invalid pending request state." });
    }
  } else if (
    !request.closedAt || !request.closedBy ||
    (request.isAdministrativeDecision
      ? !request.administrativeReason
      : request.administrativeReason !== null)
  ) {
    context.addIssue({ code: "custom", message: "Invalid terminal request state." });
  }
});
const creationOutcomeSchema = z.union([
  z.object({
    itemId: uuidSchema,
    outcome: z.literal("included"),
    requestItemId: uuidSchema,
    requestItemVersion: z.number().int().positive(),
  }).strict(),
  z.object({
    itemId: uuidSchema,
    outcome: z.literal("problem"),
    problem: z.enum(TMC_OPERATION_PROBLEM_CODES),
  }).strict(),
]);
const createResultSchema = z.object({
  request: requestSchema.nullable(),
  total: z.number().int().nonnegative(),
  included: z.number().int().nonnegative(),
  problems: z.number().int().nonnegative(),
  items: z.array(creationOutcomeSchema),
}).strict().superRefine((result, context) => {
  const included = result.items.filter((item) => item.outcome === "included").length;
  const problems = result.items.length - included;
  if (
    result.total !== result.items.length ||
    result.included !== included ||
    result.problems !== problems ||
    result.total !== result.included + result.problems ||
    (result.request ? result.request.items.length !== included : included !== 0)
  ) {
    context.addIssue({ code: "custom", message: "Creation result summary mismatch." });
  }
});

export function parseCreateTmcTransferRequestResult(
  value: unknown,
): CreateTmcTransferRequestResultDto {
  const parsed = createResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("tmc_idempotency_response_invalid", { cause: parsed.error });
  }
  return parsed.data as CreateTmcTransferRequestResultDto;
}

export function parseTmcTransferRequest(value: unknown): TmcTransferRequestDto {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("tmc_idempotency_response_invalid", { cause: parsed.error });
  }
  return parsed.data as TmcTransferRequestDto;
}

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
