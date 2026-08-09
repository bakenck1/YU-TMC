import type {
  InsertedTmcTransferRequestItemRecord,
  TmcOperationRepositories,
  TmcOperationUserRecord,
  TmcTransferCandidateRecord,
  TmcTransferRequestItemRecord,
  TmcTransferRequestRecord,
  TmcTransferUserRecord,
} from "@/lib/application/ports/tmc-operation-repositories";
import { TmcOperationRepositoryConflictError } from "@/lib/application/ports/tmc-operation-repositories";
import { executeIdempotentCommand } from "@/lib/application/services/idempotent-command-service";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type {
  CreateTmcTransferRequestInput,
  CreateTmcTransferRequestResultDto,
  DecideTmcTransferRequestInput,
  TmcOperationProblemCode,
  TmcTransferRequestDto,
  TmcTransferRequestItemDto,
  TmcTransferRequestSummaryDto,
} from "@/lib/contracts/tmc-operations";
import { parseCreateTmcTransferRequestResult, parseTmcTransferRequest } from "@/lib/contracts/tmc-operations";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import {
  canPerformInventoryOperation,
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

const MAX_ITEMS = 50;
const MAX_COMMENT_CODE_POINTS = 1_000;
const REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const CREATE_OPERATION = "tmc.transfer_request.create";
const DECIDE_OPERATION = "tmc.transfer_request.decision";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

export interface TmcTransferRequestServiceClock {
  now(): Date;
}

export interface TmcTransferRequestServiceIds {
  create(): string;
}

export interface IdempotentTmcTransferRequestCreation {
  body: { result: CreateTmcTransferRequestResultDto };
  kind: "completed" | "replayed";
  result: CreateTmcTransferRequestResultDto;
  resourceId?: string;
  status: number;
}

export interface IdempotentTmcTransferRequestDecision {
  body: { request: TmcTransferRequestDto };
  kind: "completed" | "replayed";
  request: TmcTransferRequestDto;
  resourceId: string;
  status: 200;
}

type ClassifiedItem =
  | {
      itemId: string;
      outcome: "candidate";
      candidate: TmcTransferCandidateRecord;
    }
  | {
      itemId: string;
      outcome: "problem";
      problem: TmcOperationProblemCode;
    };

type RejectedCreateResult = Extract<
  CreateTmcTransferRequestResultDto,
  { request: null }
>;

export class TmcTransferRequestService {
  constructor(
    private readonly unitOfWork: UnitOfWork<TmcOperationRepositories>,
    private readonly clock: TmcTransferRequestServiceClock,
    private readonly ids: TmcTransferRequestServiceIds,
  ) {}

  async getById(
    id: string,
    actor: AuthorizationActor,
  ): Promise<TmcTransferRequestDto> {
    if (
      !isUuid(id) ||
      !isUuid(actor.userId) ||
      !hasPermission(actor.role, "inventory.tmc.transfer_request.create")
    ) throw requestNotFound();
    const request = await this.unitOfWork.read(({ transferRequests }) =>
      transferRequests.findById(id.toLowerCase()),
    );
    const actorId = actor.userId.toLowerCase();
    if (
      !request ||
      (actor.role !== "admin" &&
        request.initiator.id !== actorId &&
        request.recipient.id !== actorId)
    ) {
      throw requestNotFound();
    }
    return toRequestDto(request, this.clock.now());
  }

  async getItemPhoto(
    requestId: string,
    itemId: string,
    actor: AuthorizationActor,
  ): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg" }> {
    if (
      !isUuid(requestId) ||
      !isUuid(itemId) ||
      !isUuid(actor.userId) ||
      !hasPermission(actor.role, "inventory.tmc.transfer_request.create")
    ) {
      throw requestNotFound();
    }
    return this.unitOfWork.read(async ({ transferRequests }) => {
      const request = await transferRequests.findById(requestId.toLowerCase());
      const actorId = actor.userId.toLowerCase();
      if (
        !request ||
        (actor.role !== "admin" &&
          request.initiator.id !== actorId &&
          request.recipient.id !== actorId)
      ) {
        throw requestNotFound();
      }
      const photo = await transferRequests.findItemPhoto(
        request.id,
        itemId.toLowerCase(),
      );
      if (!photo) throw requestNotFound();
      return photo;
    });
  }

  async decide(
    requestId: string,
    input: DecideTmcTransferRequestInput,
    actor: AuthorizationActor,
  ): Promise<TmcTransferRequestDto> {
    const normalized = normalizeDecisionInput(requestId, input, actor);
    try {
      return await this.unitOfWork.transaction(async ({ transferRequests }) => {
      const request = await transferRequests.findByIdForUpdate(normalized.requestId);
      if (!request) throw requestNotFound();
      const actorId = normalized.actorId;
      const isRecipient = request.recipient.id === actorId;
      const currentActor = await transferRequests.findUserById(actorId);
      if (!currentActor || !currentActor.active || currentActor.deletedAt) {
        throw requestNotFound();
      }
      const isAdministrativeDecision = !isRecipient && currentActor.role === "admin";
      if (!isRecipient && !isAdministrativeDecision) throw requestNotFound();
      const recipient = isRecipient
        ? currentActor
        : await transferRequests.findUserById(request.recipient.id);
      if (!recipient || !recipient.active || recipient.deletedAt) {
        throw new ApplicationError("conflict", "recipient_unavailable");
      }
      const administrativeReason = normalizeAdministrativeReason(
        normalized.administrativeReason,
        isAdministrativeDecision,
      );
      if (request.status !== "pending") {
        throw new ApplicationError("conflict", "request_already_closed");
      }
      if (request.version !== normalized.requestVersion) {
        throw new ApplicationError("conflict", "version_conflict");
      }
      const pending = request.items.filter((item) => item.result === "pending");
      const decisions = new Map(normalized.decisions.map((decision) => [decision.itemId, decision]));
      if (
        pending.length === 0 ||
        decisions.size !== pending.length ||
        pending.some((item) => !decisions.has(item.itemId))
      ) {
        throw new ApplicationError("validation", "decision_coverage_mismatch");
      }
      for (const item of pending) {
        if (decisions.get(item.itemId)?.itemVersion !== item.version) {
          throw new ApplicationError("conflict", "version_conflict");
        }
      }
      const decidedAt = this.clock.now();
      const results: Array<"accepted" | "rejected" | "invalidated"> = [];
      for (const item of [...pending].sort((left, right) => left.itemId.localeCompare(right.itemId))) {
        const decision = decisions.get(item.itemId)!;
        results.push(await transferRequests.decideItem({
          requestId: request.id,
          requestItemId: item.id,
          itemId: item.itemId,
          responsibilityPeriodIdAtRequest: item.responsibilityPeriodIdAtRequest,
          currentResponsibleIdAtRequest: item.currentResponsibleIdAtRequest,
          expectedVersion: item.version,
          decision: decision.decision,
          recipientId: request.recipient.id,
          decidedBy: actorId,
          decidedAt,
          newResponsibilityPeriodId: this.ids.create(),
        }));
      }
      const hasAccepted =
        request.items.some((item) => item.result === "accepted") ||
        results.includes("accepted");
      const closed = await transferRequests.closeRequest({
        requestId: request.id,
        expectedVersion: request.version,
        status: hasAccepted ? "accepted" : "rejected",
        closedBy: actorId,
        closedAt: decidedAt,
        isAdministrativeDecision,
        administrativeReason,
      });
      if (!closed) throw new ApplicationError("conflict", "version_conflict");
      const updated = await transferRequests.findById(request.id);
      if (!updated) throw incompleteProjection();
        return toRequestDto(updated, this.clock.now());
      }, { isolation: "serializable", maxAttempts: 3 });
    } catch (error) {
      if (error instanceof TmcOperationRepositoryConflictError) {
        throw new ApplicationError("conflict", error.problem, { cause: error });
      }
      throw error;
    }
  }

  async decideIdempotent(
    requestId: string,
    input: DecideTmcTransferRequestInput,
    actor: AuthorizationActor,
    idempotencyKey: string,
  ): Promise<IdempotentTmcTransferRequestDecision> {
    const normalized = normalizeDecisionInput(requestId, input, actor);
    const key = normalizeTmcIdempotencyKey(idempotencyKey);
    const execution = await executeIdempotentCommand(
      this.unitOfWork,
      {
        id: this.ids.create(),
        actorId: normalized.actorId,
        operation: DECIDE_OPERATION,
        key,
        requestHash: await hashDecisionRequest(normalized),
        expiresInMs: IDEMPOTENCY_LIFETIME_MS,
      },
      async () => {
        const request = await this.decide(
          normalized.requestId,
          {
            requestVersion: normalized.requestVersion,
            decisions: normalized.decisions,
            administrativeReason: normalized.administrativeReason,
          },
          actor,
        );
        return { body: { request }, resourceId: request.id, status: 200 };
      },
      {
        afterReserve: async ({ transferRequests }) => {
          const request = await transferRequests.findById(normalized.requestId);
          if (!request) throw requestNotFound();
          const currentActor = await transferRequests.findUserById(normalized.actorId);
          if (
            !currentActor ||
            !currentActor.active ||
            currentActor.deletedAt ||
            (request.recipient.id !== normalized.actorId && currentActor.role !== "admin")
          ) {
            throw requestNotFound();
          }
        },
        transaction: { isolation: "serializable", maxAttempts: 3 },
      },
    );
    const request = readStoredDecision(execution.response, normalized.requestId);
    return {
      body: { request },
      kind: execution.kind,
      request,
      resourceId: request.id,
      status: 200,
    };
  }

  async createIdempotent(
    input: CreateTmcTransferRequestInput,
    actor: AuthorizationActor,
    idempotencyKey: string,
  ): Promise<IdempotentTmcTransferRequestCreation> {
    if (
      !isUuid(actor.userId) ||
      !hasPermission(actor.role, "inventory.tmc.transfer_request.create")
    ) {
      throw forbidden();
    }
    const key = normalizeTmcIdempotencyKey(idempotencyKey);
    const normalized = normalizeCreateInput(input);
    const actorId = actor.userId.toLowerCase();
    const commandActor = { ...actor, userId: actorId };
    const execution = await executeIdempotentCommand(
      this.unitOfWork,
      {
        id: this.ids.create(),
        actorId,
        operation: CREATE_OPERATION,
        key,
        requestHash: await hashCreateRequest(normalized),
        expiresInMs: IDEMPOTENCY_LIFETIME_MS,
      },
      async () => {
        const result = await this.create(normalized, commandActor);
        return {
          body: { result },
          ...(result.request ? { resourceId: result.request.id } : {}),
          status: result.request ? 201 : 200,
        };
      },
      {
        afterReserve: async ({ transferRequests }) => {
          const users = new Map<string, TmcTransferUserRecord>();
          for (const userId of [...new Set([
            actorId,
            normalized.recipientId,
          ])].sort()) {
            const user = await transferRequests.findUserById(userId);
            if (user) users.set(user.id, user);
          }
          const currentActor = users.get(actorId);
          if (
            !currentActor ||
            !currentActor.active ||
            currentActor.deletedAt ||
            !hasPermission(
              currentActor.role,
              "inventory.tmc.transfer_request.create",
            )
          ) {
            throw forbidden();
          }
        },
        transaction: { isolation: "serializable", maxAttempts: 3 },
      },
    );
    const result = readStoredCreateResult(execution.response);
    return {
      body: { result },
      kind: execution.kind,
      result,
      ...(execution.response.resourceId
        ? { resourceId: execution.response.resourceId }
        : {}),
      status: execution.response.status,
    };
  }

  async create(
    input: CreateTmcTransferRequestInput,
    actor: AuthorizationActor,
  ): Promise<CreateTmcTransferRequestResultDto> {
    if (
      !isUuid(actor.userId) ||
      !hasPermission(actor.role, "inventory.tmc.transfer_request.create")
    ) {
      throw forbidden();
    }
    const actorId = actor.userId.toLowerCase();
    const normalized = normalizeCreateInput(input);

    try {
      return await this.unitOfWork.transaction(async ({ transferRequests }) => {
      const users = new Map<string, TmcTransferUserRecord>();
      for (const userId of [...new Set([
        actorId,
        normalized.recipientId,
      ])].sort()) {
        const user = await transferRequests.findUserById(userId);
        if (user) users.set(user.id, user);
      }
      const currentActor = users.get(actorId);
      if (
        !currentActor ||
        !currentActor.active ||
        currentActor.deletedAt ||
        !hasPermission(
          currentActor.role,
          "inventory.tmc.transfer_request.create",
        )
      ) {
        throw forbidden();
      }
      const authorizedActor: AuthorizationActor = {
        userId: currentActor.id,
        role: currentActor.role,
      };
      const recipient = users.get(normalized.recipientId);
      if (!recipient) throw validation("recipient_not_found");
      if (!recipient.active || recipient.deletedAt) {
        throw validation("recipient_unavailable");
      }
      if (recipient.id === authorizedActor.userId) {
        throw validation("recipient_must_differ_from_initiator");
      }

      const candidates = await transferRequests.findCandidates(
        normalized.itemIds,
      );
      const classified = classifyItems(
        normalized.itemIds,
        candidates,
        recipient.id,
        authorizedActor,
      );
      const included = classified.filter(
        (item): item is Extract<ClassifiedItem, { outcome: "candidate" }> =>
          item.outcome === "candidate",
      );

      if (included.length === 0) {
        return {
          request: null,
          total: classified.length,
          included: 0,
          problems: classified.length,
          items: classified.map((item) => {
            if (item.outcome !== "problem") {
              throw new Error("tmc_transfer_request_classification_invalid");
            }
            return {
              itemId: item.itemId,
              outcome: item.outcome,
              problem: item.problem,
            };
          }),
        };
      }

      const requestId = this.ids.create();
      const createdAt = this.clock.now();
      await transferRequests.insertRequest({
        id: requestId,
        initiatorId: authorizedActor.userId,
        recipientId: recipient.id,
        comment: normalized.comment,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + REQUEST_LIFETIME_MS),
      });

      const insertedByItemId = new Map<
        string,
        InsertedTmcTransferRequestItemRecord
      >();
      const lateProblemsByItemId = new Map<string, TmcOperationProblemCode>();
      for (const item of included) {
        try {
          const inserted = await this.unitOfWork.transaction(
            ({ transferRequests: nestedRequests }) =>
              nestedRequests.insertRequestItem({
                id: this.ids.create(),
                requestId,
                itemId: item.itemId,
                expectedItemVersion: item.candidate.itemVersion,
                responsibilityPeriodIdAtRequest:
                  item.candidate.responsibilityPeriodId!,
                currentResponsibleIdAtRequest:
                  item.candidate.responsibleUser!.id,
                createdAt,
              }),
          );
          insertedByItemId.set(item.itemId, inserted);
        } catch (error) {
          if (!(error instanceof TmcOperationRepositoryConflictError)) {
            throw error;
          }
          lateProblemsByItemId.set(item.itemId, error.problem);
        }
      }

      if (insertedByItemId.size === 0) {
        throw new EmptyTmcTransferRequestError({
          request: null,
          total: classified.length,
          included: 0,
          problems: classified.length,
          items: classified.map((item) => {
            const lateProblem = lateProblemsByItemId.get(item.itemId);
            if (item.outcome === "problem") {
              return {
                itemId: item.itemId,
                outcome: "problem" as const,
                problem: item.problem,
              };
            }
            if (!lateProblem) {
              throw new Error("tmc_transfer_request_classification_invalid");
            }
            return {
              itemId: item.itemId,
              outcome: "problem" as const,
              problem: lateProblem,
            };
          }),
        });
      }

      const persisted = await transferRequests.findById(requestId);
      assertCompleteProjection(persisted, requestId, insertedByItemId);
      const items = classified.map((item) => {
        if (item.outcome === "problem") {
          return {
            itemId: item.itemId,
            outcome: "problem" as const,
            problem: item.problem,
          };
        }
        const lateProblem = lateProblemsByItemId.get(item.itemId);
        if (lateProblem) {
          return {
            itemId: item.itemId,
            outcome: "problem" as const,
            problem: lateProblem,
          };
        }
        const inserted = insertedByItemId.get(item.itemId)!;
        return {
          itemId: item.itemId,
          outcome: "included" as const,
          requestItemId: inserted.id,
          requestItemVersion: inserted.version,
        };
      });

      return {
        request: toRequestDto(persisted, this.clock.now()),
        total: items.length,
        included: insertedByItemId.size,
        problems: items.length - insertedByItemId.size,
        items,
      };
      }, { isolation: "serializable", maxAttempts: 3 });
    } catch (error) {
      if (error instanceof EmptyTmcTransferRequestError) return error.result;
      throw error;
    }
  }
}

class EmptyTmcTransferRequestError extends Error {
  constructor(readonly result: RejectedCreateResult) {
    super("No TMC transfer request items remained after atomic validation.");
    this.name = "EmptyTmcTransferRequestError";
  }
}

function normalizeCreateInput(input: CreateTmcTransferRequestInput) {
  if (!input || typeof input !== "object") throw validation("invalid_request");
  if (!isUuid(input.recipientId)) throw validation("invalid_recipient_id");
  if (!Array.isArray(input.itemIds)) throw validation("invalid_item_ids");
  if (input.itemIds.length < 1) throw validation("items_required");
  if (input.itemIds.length > MAX_ITEMS) throw validation("too_many_items");
  if (!input.itemIds.every((itemId) => isUuid(itemId))) {
    throw validation("invalid_item_ids");
  }
  return {
    recipientId: input.recipientId.toLowerCase(),
    itemIds: input.itemIds.map((itemId) => itemId.toLowerCase()),
    comment: normalizeComment(input.comment),
  };
}

export function normalizeTmcIdempotencyKey(value: unknown) {
  if (value === undefined || value === null || value === "") {
    throw validation("idempotency_key_required");
  }
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw validation("idempotency_key_invalid");
  }
  return value;
}

async function hashCreateRequest(
  input: ReturnType<typeof normalizeCreateInput>,
) {
  const payload = new TextEncoder().encode(
    JSON.stringify({ operation: CREATE_OPERATION, ...input }),
  );
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashDecisionRequest(
  input: ReturnType<typeof normalizeDecisionInput>,
) {
  const payload = new TextEncoder().encode(JSON.stringify({
    operation: DECIDE_OPERATION,
    requestId: input.requestId,
    requestVersion: input.requestVersion,
    decisions: [...input.decisions].sort((left, right) =>
      left.itemId.localeCompare(right.itemId),
    ),
    administrativeReason:
      typeof input.administrativeReason === "string"
        ? input.administrativeReason.normalize("NFKC").trim()
        : null,
  }));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readStoredCreateResult(response: {
  body: Record<string, unknown>;
  resourceId?: string;
  status: number;
}) {
  const result = parseCreateTmcTransferRequestResult(response.body.result);
  if (result.request) {
    if (response.status !== 201 || response.resourceId !== result.request.id) {
      throw new Error("tmc_idempotency_response_invalid");
    }
  } else if (response.status !== 200 || response.resourceId !== undefined) {
    throw new Error("tmc_idempotency_response_invalid");
  }
  return result;
}

function readStoredDecision(
  response: { body: Record<string, unknown>; resourceId?: string; status: number },
  requestId: string,
) {
  const request = parseTmcTransferRequest(response.body.request);
  if (response.status !== 200 || response.resourceId !== requestId || request.id !== requestId) {
    throw new Error("tmc_idempotency_response_invalid");
  }
  return request;
}

function normalizeComment(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw validation("invalid_comment");
  const comment = value.normalize("NFKC").trim();
  if (!comment) return null;
  if (comment.includes("\u0000") || [...comment].length > MAX_COMMENT_CODE_POINTS) {
    throw validation("invalid_comment");
  }
  return comment;
}

function classifyItems(
  itemIds: readonly string[],
  candidates: readonly TmcTransferCandidateRecord[],
  recipientId: string,
  actor: AuthorizationActor,
): ClassifiedItem[] {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.itemId, candidate]),
  );
  const seen = new Set<string>();
  return itemIds.map((itemId) => {
    if (seen.has(itemId)) return problem(itemId, "duplicate_item");
    seen.add(itemId);
    const candidate = candidatesById.get(itemId);
    if (!candidate) return problem(itemId, "item_not_found");
    if (
      !canPerformInventoryOperation(actor, {
        operation: "tmc.transfer_request.create",
        currentResponsibleId: candidate.responsibleUser?.id ?? "",
      })
    ) {
      return problem(itemId, "forbidden");
    }
    if (candidate.itemStatus !== "active" || candidate.archivedAt) {
      return problem(itemId, "item_inactive");
    }
    if (!candidate.responsibilityPeriodId || !candidate.responsibleUser) {
      return problem(itemId, "item_unassigned");
    }
    if (candidate.responsibleUser.id === recipientId) {
      return problem(itemId, "already_responsible");
    }
    if (candidate.hasActiveTransfer) {
      return problem(itemId, "active_transfer_exists");
    }
    return { itemId, outcome: "candidate", candidate };
  });
}

function problem(
  itemId: string,
  code: TmcOperationProblemCode,
): ClassifiedItem {
  return { itemId, outcome: "problem", problem: code };
}

function assertCompleteProjection(
  request: TmcTransferRequestRecord | null,
  requestId: string,
  insertedByItemId: ReadonlyMap<string, InsertedTmcTransferRequestItemRecord>,
): asserts request is TmcTransferRequestRecord {
  if (!request || request.id !== requestId) throw incompleteProjection();
  if (request.items.length !== insertedByItemId.size) throw incompleteProjection();
  const projectedByItemId = new Map(
    request.items.map((item) => [item.itemId, item]),
  );
  for (const [itemId, inserted] of insertedByItemId) {
    const projected = projectedByItemId.get(itemId);
    if (!projected || projected.id !== inserted.id) throw incompleteProjection();
  }
}

function incompleteProjection() {
  return new Error("tmc_transfer_request_projection_incomplete");
}

function toRequestDto(
  record: TmcTransferRequestRecord,
  now: Date,
): TmcTransferRequestDto {
  const base = {
    id: record.id,
    initiator: toUserDto(record.initiator),
    recipient: toUserDto(record.recipient),
    comment: record.comment,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    overdue: now.getTime() >= record.expiresAt.getTime(),
    version: record.version,
    summary: summarize(record.items),
    items: record.items.map(toRequestItemDto),
  };
  if (record.status === "pending") {
    if (
      record.closedAt ||
      record.closedBy ||
      record.isAdministrativeDecision ||
      record.administrativeReason
    ) {
      throw incompleteProjection();
    }
    return {
      ...base,
      status: "pending",
      closedAt: null,
      closedBy: null,
      isAdministrativeDecision: false,
      administrativeReason: null,
    };
  }
  if (!record.closedAt || !record.closedBy) throw incompleteProjection();
  if (record.isAdministrativeDecision) {
    if (!record.administrativeReason) throw incompleteProjection();
    return {
      ...base,
      status: record.status,
      closedAt: record.closedAt.toISOString(),
      closedBy: toUserDto(record.closedBy),
      isAdministrativeDecision: true,
      administrativeReason: record.administrativeReason,
    };
  }
  if (record.administrativeReason) throw incompleteProjection();
  return {
    ...base,
    status: record.status,
    closedAt: record.closedAt.toISOString(),
    closedBy: toUserDto(record.closedBy),
    isAdministrativeDecision: false,
    administrativeReason: null,
  };
}

function toRequestItemDto(
  record: TmcTransferRequestItemRecord,
): TmcTransferRequestItemDto {
  const base = {
    id: record.id,
    requestId: record.requestId,
    item: {
      id: record.item.id,
      name: record.item.name,
      inventoryNumber: record.item.inventoryNumber,
      quantity: record.item.quantity,
      unitPrice: record.item.unitPrice,
      photoUrl: record.item.photoUrl
        ? `/api/inventory/transfer-requests/${record.requestId}/items/${record.item.id}/photo`
        : null,
      location: {
        buildingId: record.item.buildingId,
        buildingName: record.item.buildingName,
        roomId: record.item.roomId,
        roomDesignation: record.item.roomDesignation,
      },
    },
    responsibilityPeriodIdAtRequest: record.responsibilityPeriodIdAtRequest,
    currentResponsibleIdAtRequest: record.currentResponsibleIdAtRequest,
    responsibleUserProfile: toUserDto(record.responsibleUserProfile),
    createdAt: record.createdAt.toISOString(),
    version: record.version,
  };
  if (record.result === "pending") {
    if (record.invalidReason || record.decidedAt || record.decidedBy) {
      throw incompleteProjection();
    }
    return {
      ...base,
      result: "pending",
      invalidReason: null,
      decidedAt: null,
      decidedBy: null,
    };
  }
  if (!record.decidedAt || !record.decidedBy) throw incompleteProjection();
  if (record.result === "invalidated") {
    if (!record.invalidReason) throw incompleteProjection();
    return {
      ...base,
      result: "invalidated",
      invalidReason: record.invalidReason,
      decidedAt: record.decidedAt.toISOString(),
      decidedBy: toUserDto(record.decidedBy),
    };
  }
  if (record.invalidReason) throw incompleteProjection();
  return {
    ...base,
    result: record.result,
    invalidReason: null,
    decidedAt: record.decidedAt.toISOString(),
    decidedBy: toUserDto(record.decidedBy),
  };
}

function summarize(
  items: readonly TmcTransferRequestItemRecord[],
): TmcTransferRequestSummaryDto {
  const summary: TmcTransferRequestSummaryDto = {
    total: items.length,
    pending: 0,
    accepted: 0,
    rejected: 0,
    cancelled: 0,
    invalidated: 0,
  };
  for (const item of items) summary[item.result] += 1;
  return summary;
}

function toUserDto(user: TmcOperationUserRecord) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };
}

function validation(publicCode: string) {
  return new ApplicationError("validation", publicCode);
}

function forbidden() {
  return new ApplicationError("forbidden", "forbidden");
}

function requestNotFound() {
  return new ApplicationError("not_found", "request_not_found");
}

function normalizeDecisionInput(
  requestId: string,
  input: DecideTmcTransferRequestInput,
  actor: AuthorizationActor,
) {
  if (!isUuid(requestId) || !isUuid(actor.userId)) throw requestNotFound();
  if (
    !Number.isInteger(input.requestVersion) ||
    input.requestVersion < 1 ||
    !Array.isArray(input.decisions) ||
    input.decisions.length < 1 ||
    input.decisions.length > MAX_ITEMS
  ) throw validation("invalid_decision");
  const decisions = input.decisions.map((decision) => {
    if (
      !isUuid(decision.itemId) ||
      !Number.isInteger(decision.itemVersion) ||
      decision.itemVersion < 1 ||
      !["accept", "reject"].includes(decision.decision)
    ) throw validation("invalid_decision");
    return { ...decision, itemId: decision.itemId.toLowerCase() };
  });
  if (new Set(decisions.map((decision) => decision.itemId)).size !== decisions.length) {
    throw validation("duplicate_item");
  }
  return {
    requestId: requestId.toLowerCase(),
    actorId: actor.userId.toLowerCase(),
    requestVersion: input.requestVersion,
    decisions,
    administrativeReason: input.administrativeReason,
  };
}

function normalizeAdministrativeReason(
  value: string | null | undefined,
  required: boolean,
) {
  const normalized = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (normalized.includes("\u0000")) {
    throw validation("invalid_administrative_reason");
  }
  if (Array.from(normalized).length > MAX_COMMENT_CODE_POINTS) {
    throw validation("administrative_reason_too_long");
  }
  if (required && !normalized) throw validation("administrative_reason_required");
  if (!required && normalized) throw validation("administrative_reason_not_allowed");
  return required ? normalized : null;
}
