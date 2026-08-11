import type {
  InsertedTmcTransferRequestItemRecord,
  TmcOperationRepositories,
  TmcOperationUserRecord,
  TmcTransferCandidateRecord,
  TmcTransferRequestItemRecord,
  TmcTransferRequestRecord,
  TmcTransferUserRecord,
  TmcStageFourRepository,
} from "@/lib/application/ports/tmc-operation-repositories";
import { TmcOperationRepositoryConflictError } from "@/lib/application/ports/tmc-operation-repositories";
import { executeIdempotentCommand } from "@/lib/application/services/idempotent-command-service";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type {
  CancelTmcTransferRequestInput,
  CreateTmcTransferRequestInput,
  CreateTmcTransferRequestResultDto,
  DecideTmcTransferRequestInput,
  TmcNotificationFeedDto,
  TmcTransferHistoryDto,
  TmcTransferHistoryFilters,
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
const CANCEL_OPERATION = "tmc.transfer_request.cancel";
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

  async listHistory(
    filters: TmcTransferHistoryFilters,
    actor: AuthorizationActor,
  ): Promise<TmcTransferHistoryDto> {
    const actorId = normalizeReader(actor);
    const normalized = normalizeHistoryFilters(filters);
    const now = this.clock.now();
    const history = await this.unitOfWork.read(async ({ stageFour }) => {
      const query = {
        actorId,
        includeAll: actor.role === "admin",
        ...normalized,
        now,
        limit: normalized.limit + 1,
      };
      const [requests, locationChanges] = await Promise.all([
        stageFour.listHistory(query),
        stageFour.listLocationHistory(query),
      ]);
      return { requests, locationChanges };
    });
    const requests = history.requests.slice(0, normalized.limit);
    const locationChanges = history.locationChanges.slice(0, normalized.limit);
    return {
      requests: requests.flatMap((request) => {
        const projected = toHistoryRequestDto(
          request,
          now,
          actorId,
          actor.role,
        );
        return projected ? [projected] : [];
      }),
      locationChanges: locationChanges.map((record) => ({
        ...record,
        occurredAt: record.occurredAt.toISOString(),
      })),
      nextRequestCursor: history.requests.length > normalized.limit
        ? encodeHistoryCursor(requests.at(-1)!.createdAt, requests.at(-1)!.id)
        : null,
      nextLocationCursor: history.locationChanges.length > normalized.limit
        ? encodeHistoryCursor(locationChanges.at(-1)!.occurredAt, locationChanges.at(-1)!.id)
        : null,
    };
  }

  async listNotifications(
    actor: AuthorizationActor,
    limit = 25,
  ): Promise<TmcNotificationFeedDto> {
    const actorId = normalizeReader(actor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw validation("invalid_limit");
    }
    const now = this.clock.now();
    return this.unitOfWork.read(async ({ stageFour }) => {
      const query = {
        actorId,
        includeAdminQueue: actor.role === "admin",
        now,
        limit,
      };
      const [notifications, unreadCount] = await Promise.all([
        stageFour.listNotifications(query),
        stageFour.countUnreadNotifications(query),
      ]);
      return {
        notifications: notifications.map((notification) => ({
          ...notification,
          occurredAt: notification.occurredAt.toISOString(),
          readAt: notification.readAt?.toISOString() ?? null,
        })),
        unreadCount,
      };
    });
  }

  async markNotificationRead(
    notificationId: string,
    actor: AuthorizationActor,
  ): Promise<void> {
    const actorId = normalizeReader(actor);
    if (!isUuid(notificationId)) throw notificationNotFound();
    const updated = await this.unitOfWork.transaction(({ stageFour }) =>
      stageFour.markNotificationRead({
        notificationId: notificationId.toLowerCase(),
        actorId,
        includeAdminQueue: actor.role === "admin",
        readAt: this.clock.now(),
      }),
    );
    if (!updated) throw notificationNotFound();
  }

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
    const projected = request
      ? toReaderScopedRequestDto(request, this.clock.now(), actorId, actor.role)
      : null;
    if (!projected) throw requestNotFound();
    return projected;
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
        !canReadRequest(request, actorId, actor.role)
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
      return await this.unitOfWork.transaction(async ({ transferRequests, stageFour }) => {
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
        await this.recordDecisionEffects(stageFour, request, updated, currentActor, decidedAt);
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

  async cancelIdempotent(
    requestId: string,
    input: CancelTmcTransferRequestInput,
    actor: AuthorizationActor,
    idempotencyKey: string,
  ): Promise<IdempotentTmcTransferRequestCancellation> {
    const normalized = normalizeCancellationInput(requestId, input, actor);
    const key = normalizeTmcIdempotencyKey(idempotencyKey);
    const execution = await executeIdempotentCommand(
      this.unitOfWork,
      {
        id: this.ids.create(), actorId: normalized.actorId,
        operation: CANCEL_OPERATION, key,
        requestHash: await hashCancellationRequest(normalized),
        expiresInMs: IDEMPOTENCY_LIFETIME_MS,
      },
      async () => {
        const request = await this.cancel(normalized.requestId, {
          requestVersion: normalized.requestVersion,
          administrativeReason: normalized.administrativeReason,
        }, actor);
        return { body: { request }, resourceId: request.id, status: 200 };
      },
      {
        afterReserve: async ({ transferRequests }) => {
          const request = await transferRequests.findById(normalized.requestId);
          const currentActor = await transferRequests.findUserById(normalized.actorId);
          if (!request || !currentActor || !currentActor.active || currentActor.deletedAt ||
              (request.initiator.id !== normalized.actorId && currentActor.role !== "admin")) {
            throw requestNotFound();
          }
        },
        transaction: { isolation: "serializable", maxAttempts: 3 },
      },
    );
    const request = readStoredDecision(execution.response, normalized.requestId);
    return { body: { request }, kind: execution.kind, request, resourceId: request.id, status: 200 };
  }

  async cancel(
    requestId: string,
    input: CancelTmcTransferRequestInput,
    actor: AuthorizationActor,
  ): Promise<TmcTransferRequestDto> {
    const normalized = normalizeCancellationInput(requestId, input, actor);
    return this.unitOfWork.transaction(async ({ transferRequests, stageFour }) => {
      const request = await transferRequests.findByIdForUpdate(normalized.requestId);
      const currentActor = await transferRequests.findUserById(normalized.actorId);
      if (!request || !currentActor || !currentActor.active || currentActor.deletedAt) throw requestNotFound();
      const isInitiator = request.initiator.id === normalized.actorId;
      const isAdministrator = currentActor.role === "admin";
      if (!isInitiator && !isAdministrator) throw requestNotFound();
      if (request.status !== "pending") throw new ApplicationError("conflict", "request_already_closed");
      if (request.version !== normalized.requestVersion) throw new ApplicationError("conflict", "version_conflict");
      const isAdministrativeDecision = isAdministrator && !isInitiator;
      const administrativeReason = normalizeAdministrativeReason(normalized.administrativeReason, isAdministrativeDecision);
      const cancelledAt = this.clock.now();
      const cancelled = await transferRequests.cancelRequest({
        requestId: request.id, expectedVersion: request.version,
        cancelledBy: currentActor.id, cancelledAt,
        isAdministrativeDecision, administrativeReason,
      });
      if (!cancelled) throw new ApplicationError("conflict", "version_conflict");
      const updated = await transferRequests.findById(request.id);
      if (!updated) throw incompleteProjection();
      await this.recordCancellationEffects(stageFour, request, updated, currentActor, cancelledAt);
      return toRequestDto(updated, this.clock.now());
    }, { isolation: "serializable", maxAttempts: 3 });
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
      return await this.unitOfWork.transaction(async ({ transferRequests, stageFour }) => {
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
                  item.candidate.responsibilityPeriodId,
                currentResponsibleIdAtRequest:
                  item.candidate.responsibleUser?.id ?? null,
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

      await this.recordCreationEffects(
        stageFour,
        persisted,
        authorizedActor,
        items.length - insertedByItemId.size,
      );
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

  private async recordCreationEffects(
    stageFour: TmcStageFourRepository,
    request: TmcTransferRequestRecord,
    actor: AuthorizationActor,
    problemCount: number,
  ) {
    const domainEventId = this.ids.create();
    await stageFour.appendAudit({
      id: this.ids.create(),
      domainEventId,
      actorId: actor.userId,
      actorRole: actor.role,
      subjectKind: "tmc_transfer_request",
      subjectId: request.id,
      subjectRevision: request.version,
      action: "tmc_transfer.requested",
      beforeValues: null,
      afterValues: {
        status: request.status,
        recipientId: request.recipient.id,
        itemCount: request.items.length,
        comment: request.comment,
      },
      occurredAt: request.createdAt,
    });
    for (const item of request.items) {
      await stageFour.appendAudit({
        id: this.ids.create(),
        domainEventId,
        actorId: actor.userId,
        actorRole: actor.role,
        subjectKind: "item",
        subjectId: item.itemId,
        subjectRevision: item.item.version,
        action: "tmc_transfer.item_requested",
        beforeValues: { responsibleUserId: item.currentResponsibleIdAtRequest },
        afterValues: {
          requestId: request.id,
          requestItemId: item.id,
          recipientId: request.recipient.id,
        },
        occurredAt: request.createdAt,
      });
    }
    await stageFour.createNotification({
      id: this.ids.create(),
      domainEventId,
      type: "tmc_transfer.requested",
      actorId: actor.userId,
      requestId: request.id,
      itemId: null,
      requestRevision: request.version,
      recipientId: request.recipient.id,
      audience: "direct_user",
      safePayload: { itemCount: request.items.length, status: request.status },
      occurredAt: request.createdAt,
    });
    await stageFour.createNotification({
      id: this.ids.create(),
      domainEventId: this.ids.create(),
      type: "tmc_transfer.overdue",
      actorId: actor.userId,
      requestId: request.id,
      itemId: null,
      requestRevision: request.version,
      audience: "admin_queue",
      safePayload: { itemCount: request.items.length, status: "pending" },
      occurredAt: request.expiresAt,
    });
    if (problemCount > 0) {
      await stageFour.createNotification({
        id: this.ids.create(),
        domainEventId: this.ids.create(),
        type: "tmc_transfer.problem",
        actorId: actor.userId,
        requestId: request.id,
        itemId: null,
        requestRevision: request.version,
        audience: "admin_queue",
        safePayload: { problemCount, itemCount: request.items.length },
        occurredAt: request.createdAt,
      });
    }
  }

  private async recordDecisionEffects(
    stageFour: TmcStageFourRepository,
    before: TmcTransferRequestRecord,
    after: TmcTransferRequestRecord,
    actor: TmcTransferUserRecord,
    occurredAt: Date,
  ) {
    const domainEventId = this.ids.create();
    await stageFour.appendAudit({
      id: this.ids.create(), domainEventId, actorId: actor.id, actorRole: actor.role,
      subjectKind: "tmc_transfer_request", subjectId: after.id,
      subjectRevision: after.version, action: "tmc_transfer.completed",
      beforeValues: { status: before.status, version: before.version },
      afterValues: {
        status: after.status,
        version: after.version,
        comment: after.comment,
        administrativeReason: after.administrativeReason,
      }, occurredAt,
    });
    for (const item of after.items) {
      const previous = before.items.find((candidate) => candidate.id === item.id);
      if (!previous || previous.result === item.result) continue;
      await stageFour.appendAudit({
        id: this.ids.create(), domainEventId, actorId: actor.id, actorRole: actor.role,
        subjectKind: "item", subjectId: item.itemId,
        subjectRevision: item.item.version, action: `tmc_transfer.item_${item.result}`,
        beforeValues: {
          requestId: before.id,
          requestItemId: previous.id,
          result: previous.result,
          responsibleUserId: previous.currentResponsibleIdAtRequest,
        },
        afterValues: {
          requestId: after.id,
          requestItemId: item.id,
          result: item.result,
          responsibleUserId: item.result === "accepted" ? after.recipient.id : previous.currentResponsibleIdAtRequest,
        },
        occurredAt,
      });
    }
    await stageFour.createNotification({
      id: this.ids.create(), domainEventId, type: "tmc_transfer.completed",
      actorId: actor.id, requestId: after.id, itemId: null,
      requestRevision: after.version, recipientId: after.initiator.id,
      audience: "direct_user",
      safePayload: { status: after.status, accepted: after.items.filter((item) => item.result === "accepted").length, itemCount: after.items.length },
      occurredAt,
    });
    const owners = new Map<string, number>();
    for (const item of after.items) {
      if (item.result !== "accepted") continue;
      const ownerId = item.currentResponsibleIdAtRequest;
      if (!ownerId) continue;
      owners.set(ownerId, (owners.get(ownerId) ?? 0) + 1);
    }
    for (const [ownerId, accepted] of owners) {
      if (ownerId === after.initiator.id) continue;
      await stageFour.createNotification({
        id: this.ids.create(), domainEventId: this.ids.create(), type: "tmc_transfer.completed",
        actorId: actor.id, requestId: after.id, itemId: null,
        requestRevision: after.version, recipientId: ownerId,
        audience: "direct_user",
        safePayload: { status: after.status, accepted, itemCount: after.items.length }, occurredAt,
      });
    }
    const invalidated = after.items.filter((item) => item.result === "invalidated").length;
    if (invalidated > 0) {
      await stageFour.createNotification({
        id: this.ids.create(), domainEventId: this.ids.create(), type: "tmc_transfer.problem",
        actorId: actor.id, requestId: after.id, itemId: null,
        requestRevision: after.version, audience: "admin_queue",
        safePayload: { problemCount: invalidated, status: after.status }, occurredAt,
      });
    }
  }

  private async recordCancellationEffects(
    stageFour: TmcStageFourRepository,
    before: TmcTransferRequestRecord,
    after: TmcTransferRequestRecord,
    actor: TmcTransferUserRecord,
    occurredAt: Date,
  ) {
    const domainEventId = this.ids.create();
    await stageFour.appendAudit({
      id: this.ids.create(), domainEventId, actorId: actor.id, actorRole: actor.role,
      subjectKind: "tmc_transfer_request", subjectId: after.id,
      subjectRevision: after.version, action: "tmc_transfer.cancelled",
      beforeValues: { status: before.status, version: before.version },
      afterValues: {
        status: after.status,
        version: after.version,
        comment: after.comment,
        administrativeReason: after.administrativeReason,
      }, occurredAt,
    });
    for (const item of after.items) {
      const previous = before.items.find((candidate) => candidate.id === item.id);
      if (!previous || previous.result === item.result) continue;
      await stageFour.appendAudit({
        id: this.ids.create(), domainEventId, actorId: actor.id, actorRole: actor.role,
        subjectKind: "item", subjectId: item.itemId,
        subjectRevision: item.item.version, action: "tmc_transfer.item_cancelled",
        beforeValues: {
          requestId: before.id,
          requestItemId: previous.id,
          result: previous.result,
        },
        afterValues: {
          requestId: after.id,
          requestItemId: item.id,
          result: item.result,
        },
        occurredAt,
      });
    }
    await stageFour.createNotification({
      id: this.ids.create(), domainEventId, type: "tmc_transfer.cancelled",
      actorId: actor.id, requestId: after.id, itemId: null,
      requestRevision: after.version, recipientId: after.recipient.id,
      audience: "direct_user",
      safePayload: { status: after.status, itemCount: after.items.length }, occurredAt,
    });
    if (actor.id !== after.initiator.id && after.initiator.id !== after.recipient.id) {
      await stageFour.createNotification({
        id: this.ids.create(), domainEventId: this.ids.create(), type: "tmc_transfer.cancelled",
        actorId: actor.id, requestId: after.id, itemId: null,
        requestRevision: after.version, recipientId: after.initiator.id,
        audience: "direct_user",
        safePayload: { status: after.status, itemCount: after.items.length }, occurredAt,
      });
    }
  }
}

export type IdempotentTmcTransferRequestCancellation = IdempotentTmcTransferRequestDecision;

function normalizeReader(actor: AuthorizationActor): string {
  if (
    !isUuid(actor.userId) ||
    !hasPermission(actor.role, "inventory.tmc.transfer_request.create")
  ) {
    throw forbidden();
  }
  return actor.userId.toLowerCase();
}

function canReadRequest(
  request: TmcTransferRequestRecord,
  actorId: string,
  role: AuthorizationActor["role"],
) {
  return role === "admin" ||
    request.initiator.id === actorId ||
    request.recipient.id === actorId ||
    request.items.some((item) => item.currentResponsibleIdAtRequest === actorId);
}

function toReaderScopedRequestDto(
  request: TmcTransferRequestRecord,
  now: Date,
  actorId: string,
  role: AuthorizationActor["role"],
): TmcTransferRequestDto | null {
  if (!canReadRequest(request, actorId, role)) return null;
  if (
    role === "admin" ||
    request.initiator.id === actorId ||
    request.recipient.id === actorId
  ) {
    return toRequestDto(request, now);
  }
  const participantItems = request.items.filter(
    (item) => item.currentResponsibleIdAtRequest === actorId,
  );
  if (participantItems.length === 0) return null;
  return toParticipantRequestDto(request, participantItems, now);
}

function toHistoryRequestDto(
  request: TmcTransferRequestRecord,
  now: Date,
  actorId: string,
  role: AuthorizationActor["role"],
) {
  return toReaderScopedRequestDto(request, now, actorId, role);
}

function toParticipantRequestDto(
  request: TmcTransferRequestRecord,
  participantItems: readonly TmcTransferRequestItemRecord[],
  now: Date,
): TmcTransferRequestDto {
  const status = requestStatusForItems(participantItems);
  if (status === "pending") {
    return toRequestDto({
      ...request,
      status,
      closedAt: null,
      closedBy: null,
      isAdministrativeDecision: false,
      administrativeReason: null,
      items: [...participantItems],
    }, now);
  }
  const finalItem = [...participantItems]
    .sort((left, right) =>
      (right.decidedAt?.getTime() ?? 0) - (left.decidedAt?.getTime() ?? 0))[0];
  if (!finalItem?.decidedAt || !finalItem.decidedBy) {
    throw incompleteProjection();
  }
  return toRequestDto({
    ...request,
    status,
    closedAt: finalItem.decidedAt,
    closedBy: finalItem.decidedBy,
    isAdministrativeDecision: false,
    administrativeReason: null,
    items: [...participantItems],
  }, now);
}

function requestStatusForItems(
  items: readonly TmcTransferRequestItemRecord[],
): TmcTransferRequestRecord["status"] {
  if (items.some((item) => item.result === "pending")) return "pending";
  if (items.some((item) => item.result === "accepted")) return "accepted";
  if (items.every((item) => item.result === "cancelled")) return "cancelled";
  return "rejected";
}

function normalizeHistoryFilters(filters: TmcTransferHistoryFilters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw validation("invalid_filters");
  }
  const identifiers = [
    "initiatorId",
    "recipientId",
    "buildingId",
    "roomId",
    "itemId",
  ] as const;
  const normalizedIds: Partial<Record<(typeof identifiers)[number], string>> = {};
  for (const field of identifiers) {
    const value = filters[field];
    if (value !== undefined) {
      if (!isUuid(value)) throw validation(`invalid_${field}`);
      normalizedIds[field] = value.toLowerCase();
    }
  }
  const createdFrom = parseHistoryDate(filters.createdFrom, "createdFrom");
  const createdTo = parseHistoryDate(filters.createdTo, "createdTo");
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw validation("invalid_period");
  }
  if (
    filters.status !== undefined &&
    !["pending", "accepted", "rejected", "cancelled"].includes(filters.status)
  ) throw validation("invalid_status");
  if (filters.overdue !== undefined && typeof filters.overdue !== "boolean") {
    throw validation("invalid_overdue");
  }
  const limit = filters.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw validation("invalid_limit");
  }
  const requestCursor = parseHistoryCursor(filters.requestCursor, "requestCursor");
  const locationCursor = parseHistoryCursor(filters.locationCursor, "locationCursor");
  return {
    ...normalizedIds,
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(createdFrom ? { createdFrom } : {}),
    ...(createdTo ? { createdTo } : {}),
    ...(filters.overdue !== undefined ? { overdue: filters.overdue } : {}),
    ...(requestCursor ? { requestCursorCreatedAt: requestCursor.at, requestCursorId: requestCursor.id } : {}),
    ...(locationCursor ? { locationCursorOccurredAt: locationCursor.at, locationCursorId: locationCursor.id } : {}),
    limit,
  };
}

function parseHistoryCursor(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 10 || value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw validation(`invalid_${field}`);
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separator = decoded.indexOf("|");
    const rawDate = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    const at = new Date(rawDate);
    if (separator < 1 || !Number.isFinite(at.getTime()) || !isUuid(id)) throw new Error("invalid");
    return { at, id: id.toLowerCase() };
  } catch {
    throw validation(`invalid_${field}`);
  }
}

function encodeHistoryCursor(at: Date, id: string) {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

function parseHistoryDate(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 40) {
    throw validation(`invalid_${field}`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw validation(`invalid_${field}`);
  return parsed;
}

function notificationNotFound() {
  return new ApplicationError("not_found", "notification_not_found");
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

async function hashCancellationRequest(
  input: ReturnType<typeof normalizeCancellationInput>,
) {
  const payload = new TextEncoder().encode(JSON.stringify({
    operation: CANCEL_OPERATION,
    requestId: input.requestId,
    requestVersion: input.requestVersion,
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
    if (
      (!candidate.responsibilityPeriodId || !candidate.responsibleUser) &&
      actor.role !== "admin"
    ) {
      return problem(itemId, "item_unassigned");
    }
    if (candidate.responsibleUser?.id === recipientId) {
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
    overdue: record.status === "pending" && now.getTime() >= record.expiresAt.getTime(),
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
    responsibleUserProfile: record.responsibleUserProfile
      ? toUserDto(record.responsibleUserProfile)
      : null,
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

function normalizeCancellationInput(
  requestId: string,
  input: CancelTmcTransferRequestInput,
  actor: AuthorizationActor,
) {
  if (!isUuid(requestId) || !isUuid(actor.userId)) throw requestNotFound();
  if (!input || typeof input !== "object" ||
      !Number.isSafeInteger(input.requestVersion) || input.requestVersion < 1) {
    throw validation("invalid_cancellation");
  }
  return {
    requestId: requestId.toLowerCase(),
    actorId: actor.userId.toLowerCase(),
    requestVersion: input.requestVersion,
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
