import type { TransferStatus } from "@/lib/contracts/inventory-responsibility";
import type {
  AcceptUnassignedTmcInput,
  BulkChangeTmcLocationInput,
  CancelTmcTransferRequestInput,
  CreateTmcTransferRequestResultDto,
  CreateTmcTransferRequestInput,
  DecideTmcTransferRequestInput,
  TmcTransferRequestDto,
  TmcTransferRequestItemDto,
  TmcTransferRequestItemState,
  TmcTransferRequestState,
  TmcTransferRequestStatus,
  TmcBulkOperationResultDto,
} from "@/lib/contracts/tmc-operations";

// Requests are immutable: editing means cancelling and creating a new request.
// @ts-expect-error no update command is part of the public domain contract
import type { UpdateTmcTransferRequestInput } from "@/lib/contracts/tmc-operations";

const createInput = {
  recipientId: "22222222-2222-4222-8222-222222222222",
  itemIds: ["33333333-3333-4333-8333-333333333333"],
  comment: null,
} satisfies CreateTmcTransferRequestInput;

const decisionInput = {
  requestVersion: 3,
  decisions: [
    {
      itemId: createInput.itemIds[0],
      itemVersion: 2,
      decision: "accept",
    },
  ],
} satisfies DecideTmcTransferRequestInput;

const administrativeDecision = {
  requestVersion: 3,
  decisions: [
    {
      itemId: createInput.itemIds[0],
      itemVersion: 2,
      decision: "reject",
    },
  ],
  administrativeReason: "Ответственный недоступен",
} satisfies DecideTmcTransferRequestInput;

const cancelInput = {
  requestVersion: 3,
} satisfies CancelTmcTransferRequestInput;

const administrativeCancelInput = {
  requestVersion: 3,
  administrativeReason: "Отмена администратором",
} satisfies CancelTmcTransferRequestInput;

const acceptUnassignedInput = {
  itemId: createInput.itemIds[0],
  itemVersion: 4,
} satisfies AcceptUnassignedTmcInput;

const bulkLocationInput = {
  items: [{ itemId: createInput.itemIds[0], itemVersion: 4 }],
  roomId: "44444444-4444-4444-8444-444444444444",
  comment: "Перемещение после инвентаризации",
} satisfies BulkChangeTmcLocationInput;

const bulkResult = {
  total: 2,
  succeeded: 1,
  problems: 1,
  items: [
    {
      itemId: createInput.itemIds[0],
      outcome: "success",
      itemVersion: 5,
    },
    {
      itemId: "55555555-5555-4555-8555-555555555555",
      outcome: "problem",
      problem: "item_inactive",
    },
  ],
} satisfies TmcBulkOperationResultDto;

const pendingRequest = {
  status: "pending",
  closedAt: null,
  closedBy: null,
  isAdministrativeDecision: false,
  administrativeReason: null,
} satisfies TmcTransferRequestState;

const invalidatedItem = {
  result: "invalidated",
  invalidReason: "responsibility_changed",
  decidedAt: "2026-08-09T12:00:00.000Z",
  decidedBy: {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Администратор",
    email: "admin@example.com",
    role: "admin",
  },
} satisfies TmcTransferRequestItemState;

declare const request: TmcTransferRequestDto;
declare const item: TmcTransferRequestItemDto;
declare const legacyStatus: TransferStatus;

const requestStatus: TmcTransferRequestStatus = request.status;
const capturedResponsibleId: string = item.currentResponsibleIdAtRequest;
const capturedResponsibleName: string =
  item.currentResponsibleAtRequest.fullName;

const partialCreateResult = {
  request,
  total: 2,
  included: 1,
  problems: 1,
  items: [
    {
      itemId: createInput.itemIds[0],
      outcome: "included",
      requestItemId: "66666666-6666-4666-8666-666666666666",
      requestItemVersion: 1,
    },
    {
      itemId: "55555555-5555-4555-8555-555555555555",
      outcome: "problem",
      problem: "active_transfer_exists",
    },
  ],
} satisfies CreateTmcTransferRequestResultDto;

const allProblemCreateResult = {
  request: null,
  total: 1,
  included: 0,
  problems: 1,
  items: [{
    itemId: createInput.itemIds[0],
    outcome: "problem",
    problem: "item_inactive",
  }],
} satisfies CreateTmcTransferRequestResultDto;

// @ts-expect-error a null request means no item was included
const nullRequestWithIncludedCount: CreateTmcTransferRequestResultDto = {
  request: null,
  total: 1,
  included: 1,
  problems: 1,
  items: [{
    itemId: createInput.itemIds[0],
    outcome: "problem",
    problem: "item_inactive",
  }],
};

const nullRequestWithIncludedItem: CreateTmcTransferRequestResultDto = {
  request: null,
  total: 1,
  included: 0,
  problems: 0,
  items: [{
    itemId: createInput.itemIds[0],
    outcome: "included",
    // @ts-expect-error a null request can contain only problem outcomes
    requestItemId: "66666666-6666-4666-8666-666666666666",
    requestItemVersion: 1,
  }],
};

// @ts-expect-error overdue is derived from expiresAt, never a persisted status
const expiredStatus: TmcTransferRequestStatus = "expired";

// @ts-expect-error legacy status semantics must not leak into grouped requests
const incompatibleStatus: TmcTransferRequestStatus = legacyStatus;

const legacyItemResult: TmcTransferRequestItemState = {
  // @ts-expect-error item results use accepted/rejected, not legacy confirmed
  result: "confirmed",
  invalidReason: null,
  decidedAt: "2026-08-09T12:00:00.000Z",
  decidedBy: invalidatedItem.decidedBy,
};

// @ts-expect-error pending items cannot contain terminal decision metadata
const pendingItemWithDecision: TmcTransferRequestItemState = {
  result: "pending",
  invalidReason: null,
  decidedAt: "2026-08-09T12:00:00.000Z",
  decidedBy: invalidatedItem.decidedBy,
};

// @ts-expect-error terminal items require decidedAt and decidedBy
const terminalItemWithoutDecision: TmcTransferRequestItemState = {
  result: "accepted",
  invalidReason: null,
};

// @ts-expect-error invalidReason belongs only to invalidated items
const terminalItemWithInvalidReason: TmcTransferRequestItemState = {
  result: "rejected",
  invalidReason: "not_allowed",
  decidedAt: "2026-08-09T12:00:00.000Z",
  decidedBy: invalidatedItem.decidedBy,
};

// @ts-expect-error a pending request cannot contain terminal close metadata
const invalidPendingRequest: TmcTransferRequestState = {
  ...pendingRequest,
  closedAt: "2026-08-09T12:00:00.000Z",
};

// @ts-expect-error an administrative terminal decision requires a reason
const invalidAdministrativeRequest: TmcTransferRequestState = {
  status: "accepted",
  closedAt: "2026-08-09T12:00:00.000Z",
  closedBy: invalidatedItem.decidedBy,
  isAdministrativeDecision: true,
  administrativeReason: null,
};

// @ts-expect-error terminal requests require close metadata
const terminalRequestWithoutClose: TmcTransferRequestState = {
  status: "accepted",
  closedAt: null,
  closedBy: null,
  isAdministrativeDecision: false,
  administrativeReason: null,
};

// @ts-expect-error invalidated items require an invalid reason
const invalidatedWithoutReason: TmcTransferRequestItemState = {
  result: "invalidated",
  invalidReason: null,
  decidedAt: "2026-08-09T12:00:00.000Z",
  decidedBy: invalidatedItem.decidedBy,
};

const clientControlledAdministrativeFlag: DecideTmcTransferRequestInput = {
  ...administrativeDecision,
  // @ts-expect-error administrative authority is derived from the server actor
  administrative: true,
};

const unknownItemDecision: DecideTmcTransferRequestInput = {
  requestVersion: 3,
  decisions: [{
    itemId: createInput.itemIds[0],
    itemVersion: 2,
    // @ts-expect-error only explicit accept/reject decisions are supported
    decision: "cancel",
  }],
};

const clientControlledCreateFields: CreateTmcTransferRequestInput = {
  ...createInput,
  // @ts-expect-error initiator identity always comes from the authenticated actor
  initiatorId: "11111111-1111-4111-8111-111111111111",
};

const clientControlledRequestStatus: CreateTmcTransferRequestInput = {
  ...createInput,
  // @ts-expect-error request status is always derived by the server
  status: "pending",
};

const clientControlledItemResult = {
  itemId: createInput.itemIds[0],
  itemVersion: 2,
  decision: "accept",
  // @ts-expect-error clients send decisions, never persisted item results
  result: "accepted",
} satisfies import("@/lib/contracts/tmc-operations").TmcTransferItemDecision;

// @ts-expect-error successful outcomes require the resulting item version
const successWithoutVersion: import("@/lib/contracts/tmc-operations").TmcOperationItemOutcomeDto = {
  itemId: createInput.itemIds[0],
  outcome: "success",
};

const successWithProblem = {
  itemId: createInput.itemIds[0],
  outcome: "success",
  itemVersion: 5,
  // @ts-expect-error successful outcomes cannot carry a problem
  problem: "version_conflict",
} satisfies import("@/lib/contracts/tmc-operations").TmcOperationItemOutcomeDto;

// @ts-expect-error problem outcomes require a typed problem code
const problemWithoutCode: import("@/lib/contracts/tmc-operations").TmcOperationItemOutcomeDto = {
  itemId: createInput.itemIds[0],
  outcome: "problem",
};

const problemWithVersion = {
  itemId: createInput.itemIds[0],
  outcome: "problem",
  problem: "item_inactive",
  // @ts-expect-error problem outcomes do not claim a new item version
  itemVersion: 5,
} satisfies import("@/lib/contracts/tmc-operations").TmcOperationItemOutcomeDto;

const unknownProblemCode = {
  itemId: createInput.itemIds[0],
  outcome: "problem",
  // @ts-expect-error problem codes are a closed domain vocabulary
  problem: "unexpected_problem",
} satisfies import("@/lib/contracts/tmc-operations").TmcOperationItemOutcomeDto;

void decisionInput;
void administrativeDecision;
void cancelInput;
void administrativeCancelInput;
void acceptUnassignedInput;
void bulkLocationInput;
void bulkResult;
void requestStatus;
void capturedResponsibleId;
void capturedResponsibleName;
void partialCreateResult;
void allProblemCreateResult;
void nullRequestWithIncludedCount;
void nullRequestWithIncludedItem;
void expiredStatus;
void incompatibleStatus;
void legacyItemResult;
void pendingItemWithDecision;
void terminalItemWithoutDecision;
void terminalItemWithInvalidReason;
void invalidPendingRequest;
void invalidAdministrativeRequest;
void terminalRequestWithoutClose;
void invalidatedWithoutReason;
void clientControlledAdministrativeFlag;
void unknownItemDecision;
void clientControlledCreateFields;
void clientControlledRequestStatus;
void clientControlledItemResult;
void successWithoutVersion;
void successWithProblem;
void problemWithoutCode;
void problemWithVersion;
void unknownProblemCode;
void (null as unknown as UpdateTmcTransferRequestInput);
