import type {
  CreateTransferInput,
  DecideTransferInput,
  ResponsibilityDto,
  ResponsibilityTimelineEntryDto,
  TransferDto,
} from "@/lib/contracts/inventory-responsibility";
import type {
  AppendResponsibilityAuditRecord,
  InventoryResponsibilityRepositories,
  ResponsibilityTimelineRecord,
  TransferRecord,
} from "@/lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import {
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

const DECISION_COMMENT_VISIBLE_CONTENT = /[\p{L}\p{N}]/u;
const DECISION_COMMENT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

type AuthenticatedDecisionActor = AuthorizationActor & {
  sessionVersion: number;
};

type AuthenticatedCancellationActor = AuthorizationActor & {
  sessionVersion: number;
};

type AuthenticatedOverrideActor = AuthorizationActor & {
  sessionVersion: number;
};

type AuthenticatedTransferListActor = AuthorizationActor & {
  sessionVersion: number;
};

export class InventoryResponsibilityService {
  constructor(
    private readonly unitOfWork: UnitOfWork<InventoryResponsibilityRepositories>,
    private readonly clock: { now(): Date },
    private readonly ids: { create(): string },
  ) {}

  async acceptFree(
    itemId: string,
    actor: AuthorizationActor,
  ): Promise<ResponsibilityDto> {
    requirePermission(actor, "inventory.responsibility.accept_free");
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const item = await responsibility.findItemState(itemId);
      if (!item) throw notFound("item_not_found");
      if (item.itemStatus !== "active") throw conflict("item_not_available");
      if (item.responsibleUserId) throw conflict("item_already_assigned");
      const startedAt = this.clock.now();
      try {
        await responsibility.insertResponsibility({
          id: this.ids.create(),
          itemId,
          responsibleUserId: actor.userId,
          source: "accepted",
          startedBy: actor.userId,
          startedAt,
        });
      } catch (error) {
        if (postgresConflict(error)) throw conflict("item_already_assigned");
        throw error;
      }
      await responsibility.appendAudit(
        audit({
          id: this.ids.create(),
          actor,
          subjectKind: "responsibility",
          subjectId: itemId,
          action: "responsibility.accepted",
          afterValues: { responsibleUserId: actor.userId, source: "accepted" },
          occurredAt: startedAt,
        }),
      );
      const updated = await responsibility.findItemState(itemId);
      return {
        itemId,
        responsibleUserId: actor.userId,
        responsibleName: updated?.responsibleName ?? actor.userId,
        startedAt: startedAt.toISOString(),
      };
    });
  }

  async requestTransfer(
    input: CreateTransferInput,
    actor: AuthorizationActor,
  ): Promise<TransferDto> {
    requirePermission(actor, "inventory.transfer.request_self");
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const item = await responsibility.findItemState(input.itemId);
      if (!item) throw notFound("item_not_found");
      if (!item.responsibleUserId) throw conflict("item_is_free");
      if (item.responsibleUserId === actor.userId) {
        throw conflict("already_responsible");
      }
      if (item.itemStatus !== "active") throw conflict("item_not_available");
      if (await responsibility.findPendingTransfer(input.itemId)) {
        throw conflict("transfer_already_pending");
      }
      try {
        const transfer = await responsibility.insertTransfer({
          id: this.ids.create(),
          itemId: input.itemId,
          requestedBy: actor.userId,
          proposedResponsibleId: actor.userId,
          currentResponsibleIdAtRequest: item.responsibleUserId,
          requestedAt: this.clock.now(),
        });
        await responsibility.appendAudit(
          audit({
            id: this.ids.create(),
            actor,
            subjectKind: "transfer",
            subjectId: transfer.id,
            action: "transfer.requested",
            afterValues: { itemId: input.itemId, proposedResponsibleId: actor.userId },
            occurredAt: this.clock.now(),
          }),
        );
        return toTransferDto(transfer, actor.userId);
      } catch (error) {
        if (postgresConflict(error)) throw conflict("transfer_already_pending");
        throw error;
      }
    });
  }

  async decideTransfer(
    id: string,
    input: DecideTransferInput,
    actor: AuthenticatedDecisionActor,
  ): Promise<TransferDto> {
    requirePermission(actor, "inventory.transfer.decide_as_current_responsible");
    if (
      !isUuid(id) ||
      !isUuid(actor.userId) ||
      !Number.isSafeInteger(actor.sessionVersion) ||
      actor.sessionVersion < 1
    ) {
      throw notFound("transfer_not_found");
    }
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      input.version > 2_147_483_647
    ) {
      throw new ApplicationError("validation", "invalid_version");
    }
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const currentActor = await responsibility.findAuthorizationUserForUpdate(
        actor.userId,
      );
      if (
        !currentActor ||
        !currentActor.active ||
        currentActor.deletedAt ||
        currentActor.version !== actor.sessionVersion ||
        currentActor.role !== actor.role ||
        !hasPermission(
          currentActor.role,
          "inventory.transfer.decide_as_current_responsible",
        )
      ) {
        throw notFound("transfer_not_found");
      }
      const current = await responsibility.findTransferForDecision(
        id.toLowerCase(),
        actor.userId.toLowerCase(),
      );
      if (!current) throw notFound("transfer_not_found");
      if (current.status !== "pending_current_owner") {
        throw conflict("transfer_not_pending");
      }
      const item = await responsibility.findItemStateForUpdate(current.itemId);
      if (
        !item ||
        item.itemStatus !== "active" ||
        !item.responsibilityPeriodId ||
        item.responsibleUserId !== actor.userId
      ) {
        throw conflict("responsibility_changed");
      }
      if (input.decision === "confirm") {
        const proposedResponsible =
          await responsibility.findAuthorizationUserForUpdate(
            current.proposedResponsibleId,
          );
        if (
          !proposedResponsible ||
          !proposedResponsible.active ||
          proposedResponsible.deletedAt ||
          proposedResponsible.role !== "employee"
        ) {
          throw conflict("proposed_responsible_unavailable");
        }
      }
      const comment =
        input.decision === "reject"
          ? normalizeComment(input.comment)
          : null;
      const closedAt = this.clock.now();
      const updated = await responsibility.decideTransfer({
        id,
        version: input.version,
        currentResponsibleIdAtRequest: actor.userId,
        status: input.decision === "confirm" ? "confirmed" : "rejected",
        closedBy: actor.userId,
        closedAt,
        decisionComment: comment,
      });
      if (!updated) throw conflict("version_conflict");
      if (input.decision === "confirm") {
        const responsibilityClosed = await responsibility.closeResponsibility({
          itemId: current.itemId,
          expectedResponsibilityPeriodId: item.responsibilityPeriodId,
          expectedResponsibleUserId: actor.userId,
          endedBy: actor.userId,
          endedAt: closedAt,
          endReason: "transfer_confirmed",
        });
        if (!responsibilityClosed) throw conflict("responsibility_changed");
        await responsibility.insertResponsibility({
          id: this.ids.create(),
          itemId: current.itemId,
          responsibleUserId: current.proposedResponsibleId,
          source: "transfer",
          startedBy: actor.userId,
          startedAt: closedAt,
        });
      }
      await responsibility.appendAudit(
        audit({
          id: this.ids.create(),
          actor,
          subjectKind: "transfer",
          subjectId: id,
          subjectRevision: updated.version,
          action: input.decision === "confirm" ? "transfer.confirmed" : "transfer.rejected",
          beforeValues: { status: current.status },
          afterValues: { status: updated.status, decisionComment: comment },
          reason: comment,
          isAdministrativeException: false,
          occurredAt: closedAt,
        }),
      );
      return toTransferDto(updated, actor.userId);
    });
  }

  async listTransfers(
    actor: AuthenticatedTransferListActor,
  ): Promise<TransferDto[]> {
    if (
      !isUuid(actor.userId) ||
      !Number.isSafeInteger(actor.sessionVersion) ||
      actor.sessionVersion < 1
    ) {
      throw notFound("transfers_not_found");
    }
    if (
      !hasPermission(actor.role, "inventory.transfer.request_self") &&
      !hasPermission(actor.role, "inventory.transfer.decide_as_current_responsible")
    ) {
      throw new ApplicationError("forbidden", "forbidden");
    }
    const normalizedActorId = actor.userId.toLowerCase();
    return this.unitOfWork.read(async ({ responsibility }) =>
      (
        await responsibility.listTransfersForAuthorizedUser({
          userId: normalizedActorId,
          role: actor.role,
          sessionVersion: actor.sessionVersion,
        })
      ).map((transfer) => toTransferDto(transfer, normalizedActorId)),
    );
  }

  async listTimeline(
    itemId: string,
    actor: AuthorizationActor,
  ): Promise<ResponsibilityTimelineEntryDto[]> {
    if (!hasPermission(actor.role, "inventory.item.read_all")) {
      throw new ApplicationError("forbidden", "forbidden");
    }
    return this.unitOfWork.read(async ({ responsibility }) => {
      const item = await responsibility.findItemState(itemId);
      if (!item) throw notFound("item_not_found");
      return (await responsibility.listTimeline(itemId)).map(toTimelineDto);
    });
  }

  async cancelTransfer(
    id: string,
    version: number,
    actor: AuthenticatedCancellationActor,
  ): Promise<TransferDto> {
    if (
      !isUuid(id) ||
      !isUuid(actor.userId) ||
      !Number.isSafeInteger(actor.sessionVersion) ||
      actor.sessionVersion < 1
    ) {
      throw notFound("transfer_not_found");
    }
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      version > 2_147_483_647
    ) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const normalizedId = id.toLowerCase();
    const normalizedActorId = actor.userId.toLowerCase();
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const currentActor = await responsibility.findAuthorizationUserForUpdate(
        normalizedActorId,
      );
      if (
        !currentActor ||
        currentActor.id !== normalizedActorId ||
        !currentActor.active ||
        currentActor.deletedAt ||
        currentActor.version !== actor.sessionVersion ||
        currentActor.role !== actor.role ||
        !hasPermission(
          currentActor.role,
          "inventory.transfer.cancel_as_requester",
        )
      ) {
        throw notFound("transfer_not_found");
      }
      const current = await responsibility.findTransferForCancellation(
        normalizedId,
        normalizedActorId,
      );
      if (!current) throw notFound("transfer_not_found");
      if (current.status !== "pending_current_owner") {
        throw conflict("transfer_not_pending");
      }
      const occurredAt = this.clock.now();
      const updated = await responsibility.cancelTransfer({
        id: normalizedId,
        version,
        requestedBy: normalizedActorId,
        closedBy: normalizedActorId,
        closedAt: occurredAt,
      });
      if (!updated) throw conflict("version_conflict");
      await responsibility.appendAudit(
        audit({
          id: this.ids.create(),
          actor: { ...actor, userId: normalizedActorId },
          subjectKind: "transfer",
          subjectId: normalizedId,
          subjectRevision: updated.version,
          action: "transfer.cancelled",
          beforeValues: { status: current.status },
          afterValues: { status: updated.status },
          reason: null,
          isAdministrativeException: false,
          occurredAt,
        }),
      );
      return toTransferDto(updated, normalizedActorId);
    }, { isolation: "serializable", maxAttempts: 3 });
  }

  async overrideTransfer(
    id: string,
    input: {
      version: number;
      reason: string;
      outcome: "assigned" | "released";
      responsibleUserId?: string | null;
    },
    actor: AuthenticatedOverrideActor,
  ): Promise<TransferDto> {
    if (
      !isUuid(id) ||
      !isUuid(actor.userId) ||
      !Number.isSafeInteger(actor.sessionVersion) ||
      actor.sessionVersion < 1
    ) {
      throw notFound("transfer_not_found");
    }
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      input.version > 2_147_483_647
    ) {
      throw new ApplicationError("validation", "invalid_version");
    }
    if (input.outcome !== "assigned" && input.outcome !== "released") {
      throw new ApplicationError("validation", "invalid_outcome");
    }
    const reason = normalizeComment(input.reason);
    if (
      input.outcome === "released" &&
      input.responsibleUserId !== undefined &&
      input.responsibleUserId !== null
    ) {
      throw new ApplicationError(
        "validation",
        "responsible_user_not_allowed",
      );
    }
    const responsibleUserId =
      input.outcome === "assigned"
        ? normalizeUserId(input.responsibleUserId)
        : null;
    const normalizedId = id.toLowerCase();
    const normalizedActorId = actor.userId.toLowerCase();
    const normalizedResponsibleUserId = responsibleUserId?.toLowerCase() ?? null;
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const currentActor = await responsibility.findAuthorizationUserForUpdate(
        normalizedActorId,
      );
      if (
        !currentActor ||
        currentActor.id !== normalizedActorId ||
        !currentActor.active ||
        currentActor.deletedAt ||
        currentActor.version !== actor.sessionVersion ||
        currentActor.role !== actor.role ||
        !hasPermission(currentActor.role, "inventory.transfer.override")
      ) {
        throw notFound("transfer_not_found");
      }
      const current = await responsibility.findTransferForOverride(normalizedId);
      if (!current || current.id !== normalizedId) {
        throw notFound("transfer_not_found");
      }
      if (current.status !== "pending_current_owner") {
        throw conflict("transfer_not_pending");
      }
      const item = await responsibility.findItemStateForUpdate(current.itemId);
      if (
        !item ||
        item.itemId !== current.itemId ||
        item.itemStatus !== "active" ||
        !item.responsibilityPeriodId ||
        item.responsibleUserId !== current.currentResponsibleIdAtRequest
      ) {
        throw conflict("responsibility_changed");
      }
      if (normalizedResponsibleUserId) {
        const target = await responsibility.findAuthorizationUserForUpdate(
          normalizedResponsibleUserId,
        );
        if (
          !target ||
          target.id !== normalizedResponsibleUserId ||
          !target.active ||
          target.deletedAt ||
          target.role !== "employee" ||
          target.id === currentActor.id
        ) {
          throw new ApplicationError(
            "validation",
            "responsible_user_not_available",
          );
        }
        if (target.id === item.responsibleUserId) {
          throw conflict("already_responsible");
        }
      }
      const occurredAt = this.clock.now();
      const updated = await responsibility.overrideTransfer({
        id: normalizedId,
        expectedItemId: current.itemId,
        expectedResponsibilityPeriodId: item.responsibilityPeriodId,
        expectedCurrentResponsibleId: item.responsibleUserId,
        version: input.version,
        administratorId: currentActor.id,
        administratorSessionVersion: actor.sessionVersion,
        closedAt: occurredAt,
        administrativeReason: reason,
        overrideOutcome: input.outcome,
        overrideResponsibleId: normalizedResponsibleUserId,
      });
      if (!updated) throw conflict("version_conflict");
      if (item?.responsibleUserId && item.responsibilityPeriodId) {
        const responsibilityClosed = await responsibility.closeResponsibility({
          itemId: current.itemId,
          expectedResponsibilityPeriodId: item.responsibilityPeriodId,
          expectedResponsibleUserId: item.responsibleUserId,
          endedBy: currentActor.id,
          endedAt: occurredAt,
          endReason: reason,
        });
        if (!responsibilityClosed) throw conflict("responsibility_changed");
      }
      if (normalizedResponsibleUserId) {
        try {
          await responsibility.insertResponsibility({
            id: this.ids.create(),
            itemId: current.itemId,
            responsibleUserId: normalizedResponsibleUserId,
            source: "admin_override",
            startedBy: currentActor.id,
            startedAt: occurredAt,
          });
        } catch (error) {
          if (postgresConflict(error)) throw conflict("responsibility_changed");
          throw error;
        }
      }
      await responsibility.appendAudit(
        audit({
          id: this.ids.create(),
          actor: { userId: currentActor.id, role: currentActor.role },
          subjectKind: "transfer",
          subjectId: normalizedId,
          subjectRevision: updated.version,
          action: "transfer.overridden",
          beforeValues: { status: current.status },
          afterValues: {
            status: updated.status,
            outcome: input.outcome,
            responsibleUserId: normalizedResponsibleUserId,
            administrativeReason: reason,
          },
          reason,
          isAdministrativeException: true,
          occurredAt,
        }),
      );
      return toTransferDto(updated, currentActor.id);
    }, { isolation: "serializable", maxAttempts: 3 });
  }
}

function requirePermission(
  actor: AuthorizationActor,
  permission:
    | "inventory.responsibility.accept_free"
    | "inventory.transfer.request_self"
    | "inventory.transfer.decide_as_current_responsible"
    | "inventory.transfer.cancel_as_requester"
    | "inventory.transfer.override",
) {
  if (!hasPermission(actor.role, permission)) {
    throw new ApplicationError("forbidden", "forbidden");
  }
}

function normalizeUserId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !isUuid(value)
  ) {
    throw new ApplicationError("validation", "invalid_responsible_user");
  }
  return value;
}

function normalizeComment(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApplicationError("validation", "comment_required");
  }
  const result = value.normalize("NFKC").trim();
  if (
    !result ||
    [...result].length > 1_000 ||
    result.includes("\u0000") ||
    DECISION_COMMENT_IGNORABLE.test(result) ||
    hasUnpairedSurrogate(result) ||
    !DECISION_COMMENT_VISIBLE_CONTENT.test(result)
  ) {
    throw new ApplicationError("validation", "comment_required");
  }
  return result;
}

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function notFound(code: string) {
  return new ApplicationError("not_found", code);
}

function conflict(code: string) {
  return new ApplicationError("conflict", code);
}

function postgresConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function audit(input: {
  id: string;
  actor: AuthorizationActor;
  subjectKind: "responsibility" | "transfer";
  subjectId: string;
  subjectRevision?: number;
  action: string;
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  reason?: string | null;
  isAdministrativeException?: boolean;
  occurredAt: Date;
}): AppendResponsibilityAuditRecord {
  const { actor, ...record } = input;
  return {
    ...record,
    actorId: actor.userId,
    actorRole: actor.role,
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
  };
}

function toTransferDto(record: TransferRecord, actorUserId: string): TransferDto {
  return {
    id: record.id,
    itemId: record.itemId,
    itemName: record.itemName ?? null,
    itemInventoryNumber: record.itemInventoryNumber ?? null,
    requestedByName: record.requestedByName,
    status: record.status,
    requestedAt: record.requestedAt.toISOString(),
    closedAt: record.closedAt?.toISOString() ?? null,
    decisionComment: record.decisionComment,
    version: record.version,
    direction:
      record.currentResponsibleIdAtRequest === actorUserId
        ? "incoming"
        : "outgoing",
  };
}

function toTimelineDto(
  record: ResponsibilityTimelineRecord,
): ResponsibilityTimelineEntryDto {
  return {
    id: record.id,
    kind: record.kind,
    occurredAt: record.occurredAt.toISOString(),
    actorName: record.actorName,
    responsibleName: record.responsibleName,
    status: record.status,
    detail: record.detail,
    closedAt: record.closedAt?.toISOString() ?? null,
  };
}
