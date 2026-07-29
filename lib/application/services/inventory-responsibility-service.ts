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
import {
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

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
        return toTransferDto(transfer);
      } catch (error) {
        if (postgresConflict(error)) throw conflict("transfer_already_pending");
        throw error;
      }
    });
  }

  async decideTransfer(
    id: string,
    input: DecideTransferInput,
    actor: AuthorizationActor,
  ): Promise<TransferDto> {
    requirePermission(actor, "inventory.transfer.decide_as_current_responsible");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const current = await responsibility.findTransfer(id);
      if (!current) throw notFound("transfer_not_found");
      if (current.status !== "pending_current_owner") {
        throw conflict("transfer_not_pending");
      }
      if (current.currentResponsibleIdAtRequest !== actor.userId) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      const comment =
        input.decision === "reject"
          ? normalizeComment(input.comment)
          : null;
      const closedAt = this.clock.now();
      const updated = await responsibility.decideTransfer({
        id,
        version: input.version,
        status: input.decision === "confirm" ? "confirmed" : "rejected",
        closedBy: actor.userId,
        closedAt,
        decisionComment: comment,
      });
      if (!updated) throw conflict("version_conflict");
      if (input.decision === "confirm") {
        await responsibility.closeResponsibility({
          itemId: current.itemId,
          endedBy: actor.userId,
          endedAt: closedAt,
          endReason: "transfer_confirmed",
        });
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
          action: input.decision === "confirm" ? "transfer.confirmed" : "transfer.rejected",
          beforeValues: { status: current.status },
          afterValues: { status: updated.status, decisionComment: comment },
          occurredAt: closedAt,
        }),
      );
      return toTransferDto(updated);
    });
  }

  async listTransfers(
    actor: AuthorizationActor,
  ): Promise<TransferDto[]> {
    if (
      !hasPermission(actor.role, "inventory.transfer.request_self") &&
      !hasPermission(actor.role, "inventory.transfer.decide_as_current_responsible")
    ) {
      throw new ApplicationError("forbidden", "forbidden");
    }
    return this.unitOfWork.read(async ({ responsibility }) =>
      (await responsibility.listTransfersForUser(actor.userId)).map(toTransferDto),
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
    actor: AuthorizationActor,
  ): Promise<TransferDto> {
    requirePermission(actor, "inventory.transfer.cancel_as_requester");
    if (!Number.isInteger(version) || version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const current = await responsibility.findTransfer(id);
      if (!current) throw notFound("transfer_not_found");
      if (current.requestedBy !== actor.userId) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      if (current.status !== "pending_current_owner") {
        throw conflict("transfer_not_pending");
      }
      const occurredAt = this.clock.now();
      const updated = await responsibility.cancelTransfer({
        id,
        version,
        closedBy: actor.userId,
        closedAt: occurredAt,
      });
      if (!updated) throw conflict("version_conflict");
      await responsibility.appendAudit(
        audit({
          id: this.ids.create(),
          actor,
          subjectKind: "transfer",
          subjectId: id,
          action: "transfer.cancelled",
          beforeValues: { status: current.status },
          afterValues: { status: "cancelled" },
          occurredAt,
        }),
      );
      return toTransferDto(updated);
    });
  }

  async overrideTransfer(
    id: string,
    input: {
      version: number;
      reason: string;
      outcome: "assigned" | "released";
      responsibleUserId?: string | null;
    },
    actor: AuthorizationActor,
  ): Promise<TransferDto> {
    requirePermission(actor, "inventory.transfer.override");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const reason = normalizeComment(input.reason);
    const responsibleUserId =
      input.outcome === "assigned"
        ? normalizeUserId(input.responsibleUserId)
        : null;
    return this.unitOfWork.transaction(async ({ responsibility }) => {
      const current = await responsibility.findTransfer(id);
      if (!current) throw notFound("transfer_not_found");
      if (current.status !== "pending_current_owner") {
        throw conflict("transfer_not_pending");
      }
      const occurredAt = this.clock.now();
      const updated = await responsibility.overrideTransfer({
        id,
        version: input.version,
        closedBy: actor.userId,
        closedAt: occurredAt,
        administrativeReason: reason,
        overrideOutcome: input.outcome,
        overrideResponsibleId: responsibleUserId,
      });
      if (!updated) throw conflict("version_conflict");
      const item = await responsibility.findItemState(current.itemId);
      if (item?.responsibleUserId) {
        await responsibility.closeResponsibility({
          itemId: current.itemId,
          endedBy: actor.userId,
          endedAt: occurredAt,
          endReason: reason,
        });
      }
      if (responsibleUserId) {
        await responsibility.insertResponsibility({
          id: this.ids.create(),
          itemId: current.itemId,
          responsibleUserId,
          source: "admin_override",
          startedBy: actor.userId,
          startedAt: occurredAt,
        });
      }
      await responsibility.appendAudit(
        audit({
          id: this.ids.create(),
          actor,
          subjectKind: "transfer",
          subjectId: id,
          action: "transfer.overridden",
          beforeValues: { status: current.status },
          afterValues: {
            status: "overridden",
            outcome: input.outcome,
            responsibleUserId,
            administrativeReason: reason,
          },
          occurredAt,
        }),
      );
      return toTransferDto(updated);
    });
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
    !/^[0-9a-f-]{36}$/i.test(value)
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
  if (!result || [...result].length > 1_000) {
    throw new ApplicationError("validation", "comment_required");
  }
  return result;
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
  action: string;
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  occurredAt: Date;
}): AppendResponsibilityAuditRecord {
  return {
    ...input,
    actorId: input.actor.userId,
    actorRole: input.actor.role,
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
  };
}

function toTransferDto(record: TransferRecord): TransferDto {
  return {
    id: record.id,
    itemId: record.itemId,
    requestedBy: record.requestedBy,
    requestedByName: record.requestedByName,
    proposedResponsibleId: record.proposedResponsibleId,
    currentResponsibleIdAtRequest: record.currentResponsibleIdAtRequest,
    currentResponsibleName: record.currentResponsibleName,
    status: record.status,
    requestedAt: record.requestedAt.toISOString(),
    closedAt: record.closedAt?.toISOString() ?? null,
    decisionComment: record.decisionComment,
    version: record.version,
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
