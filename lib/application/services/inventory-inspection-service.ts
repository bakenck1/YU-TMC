import type {
  AddInspectionRoomInput,
  CreateInspectionInput,
  InspectionDto,
  InspectionRoomDto,
} from "@/lib/contracts/inventory-inspections";
import type {
  ItemResultDto,
  RecordItemResultInput,
} from "@/lib/contracts/inventory-inspection-results";
import { ITEM_RESULT_VALUES } from "@/lib/contracts/inventory-domain";
import type {
  AppendInspectionAuditRecord,
  InspectionRecord,
  InventoryInspectionRepositories,
  InventoryInspectionRepository,
} from "@/lib/application/ports/inventory-inspection-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import {
  canPerformInventoryOperation,
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

export class InventoryInspectionService {
  constructor(
    private readonly unitOfWork: UnitOfWork<InventoryInspectionRepositories>,
    private readonly clock: { now(): Date },
    private readonly ids: { create(): string },
  ) {}

  async list(actor: AuthorizationActor): Promise<InspectionDto[]> {
    const records = await this.unitOfWork.read(async ({ inspections }) => {
      if (hasPermission(actor.role, "inventory.inspection.read_all")) {
        return inspections.listInspections();
      }
      if (hasPermission(actor.role, "inventory.inspection.read_own")) {
        return inspections.listInspections(actor.userId);
      }
      throw forbidden();
    });
    return Promise.all(records.map((record) => this.toDto(record)));
  }

  async create(
    input: CreateInspectionInput,
    actor: AuthorizationActor,
  ): Promise<InspectionDto> {
    const canCreate =
      (actor.role === "warehouse" &&
        hasPermission(actor.role, "inventory.inspection.create_self")) ||
      hasPermission(
        actor.role,
        "inventory.inspection.create_for_technician",
      );
    if (!canCreate) {
      throw forbidden();
    }
    const name = normalizeName(input.name);
    const technicianId = hasPermission(
      actor.role,
      "inventory.inspection.create_for_technician",
    )
      ? normalizeTechnicianId(input.technicianId)
      : actor.userId;
    const createdAt = this.clock.now();
    const deadlineAt = normalizeDeadline(input.deadlineAt, createdAt);
    const inspection = await this.unitOfWork.transaction(
      async ({ inspections }) => {
        if (!(await inspections.findAssignableTechnician(technicianId))) {
          throw notFound("technician_not_found");
        }
        const record = await inspections.insertInspection({
          id: this.ids.create(),
          name,
          technicianId,
          createdBy: actor.userId,
          createdAt,
          deadlineAt,
        });
        await inspections.appendAudit(
          audit({
            id: this.ids.create(),
            actor,
            subjectId: record.id,
            action: "inspection.created",
            afterValues: { name, technicianId, status: "draft" },
            occurredAt: createdAt,
          }),
        );
        return this.toDto(record, inspections);
      },
    );
    return inspection;
  }

  async addRoom(
    inspectionId: string,
    input: AddInspectionRoomInput,
    actor: AuthorizationActor,
  ): Promise<InspectionRoomDto> {
    const canMutateAll = hasPermission(
      actor.role,
      "inventory.inspection.mutate_all",
    );
    if (
      !canMutateAll &&
      !(
        hasPermission(actor.role, "inventory.inspection.mutate_own_draft")
      )
    ) {
      throw forbidden();
    }
    if (!isUuid(input.buildingId) || !isUuid(input.roomId)) {
      throw new ApplicationError("validation", "invalid_request");
    }
    return this.unitOfWork.transaction(async ({ inspections }) => {
      const inspection = await inspections.findInspectionForUpdate(inspectionId);
      if (
        !inspection ||
        !canPerformInventoryOperation(actor, {
          operation: "inspection.add_room",
          technicianId: inspection.technicianId,
        })
      ) {
        throw notFound("inspection_not_found");
      }
      if (inspection.status !== "draft") {
        throw new ApplicationError("conflict", "inspection_not_editable");
      }
      const snapshot = await inspections.findActiveRoomSnapshot(
        input.buildingId,
        input.roomId,
      );
      if (!snapshot) throw notFound("room_not_found");
      const room = await inspections.insertInspectionRoom({
        id: this.ids.create(),
        inspectionId,
        snapshot,
        addedBy: actor.userId,
        addedAt: this.clock.now(),
      });
      await inspections.snapshotRoomItems(room.id, room.roomId, room.addedAt);
      await inspections.appendAudit(
        audit({
          id: this.ids.create(),
          actor,
          subjectId: room.id,
          action: "inspection.room_added",
          afterValues: {
            inspectionId,
            roomId: input.roomId,
            buildingId: input.buildingId,
          },
          occurredAt: this.clock.now(),
        }),
      );
      return toRoomDto(room);
    });
  }

  async recordItemResult(
    inspectionId: string,
    inspectionRoomId: string,
    input: RecordItemResultInput,
    actor: AuthorizationActor,
  ): Promise<ItemResultDto> {
    const canRecordAll = hasPermission(
      actor.role,
      "inventory.result.record_all",
    );
    if (
      !canRecordAll &&
      !(
        hasPermission(actor.role, "inventory.result.record_own_inspection")
      )
    ) {
      throw forbidden();
    }
    if (!ITEM_RESULT_VALUES.includes(input.result)) {
      throw new ApplicationError("validation", "invalid_item_result");
    }
    const comment = normalizeOptionalComment(input.comment);
    return this.unitOfWork.transaction(async ({ inspections }) => {
      const inspection = await inspections.findInspectionForUpdate(inspectionId);
      if (!inspection) throw notFound("inspection_not_found");
      if (inspection.technicianId !== actor.userId && !canRecordAll) {
        throw notFound("inspection_not_found");
      }
      if (inspection.status !== "draft") {
        throw new ApplicationError("conflict", "inspection_not_editable");
      }
      const inspectionRoom = await inspections.findInspectionRoom(
        inspectionId,
        inspectionRoomId,
      );
      if (!inspectionRoom) throw notFound("inspection_room_not_found");
      const snapshot = await inspections.findExpectedItem(
        inspectionRoomId,
        input.itemId,
      );
      if (!snapshot) throw notFound("item_not_found");
      const existing = await inspections.findItemResult(inspectionId, input.itemId);
      const occurredAt = this.clock.now();
      if (existing) {
        const revisionNumber = existing.revisionNumber + 1;
        await inspections.insertItemResultRevision({
          resultId: existing.id,
          revisionNumber,
          inspectionRoomId,
          observedRoomId: inspectionRoom.roomId,
          result: input.result,
          comment,
          createdBy: actor.userId,
          createdAt: occurredAt,
        });
        return toItemResultDto({
          ...existing,
          result: input.result,
          comment,
          revisionNumber,
        });
      }
      if (snapshot.registryRoomId !== inspectionRoom.roomId) {
        throw notFound("item_not_found");
      }
      let created;
      try {
        created = await inspections.insertItemResult({
          id: this.ids.create(),
          inspectionId,
          inspectionRoomId,
          snapshot,
          createdBy: actor.userId,
          createdAt: occurredAt,
        });
      } catch (error) {
        if (!postgresConflict(error)) throw error;
        const concurrent = await inspections.findItemResult(inspectionId, input.itemId);
        if (concurrent) return toItemResultDto(concurrent);
        throw error;
      }
      await inspections.insertItemResultRevision({
        resultId: created.id,
        revisionNumber: 1,
        inspectionRoomId,
        observedRoomId: inspectionRoom.roomId,
        result: input.result,
        comment,
        createdBy: actor.userId,
        createdAt: occurredAt,
      });
      await inspections.markInspectionRoomCompletedIfReady(
        inspectionRoomId,
        actor.userId,
        occurredAt,
      );
      const completed = await inspections.completeInspectionIfReady(
        inspectionId,
        occurredAt,
      );
      await inspections.appendAudit(
        audit({
          id: this.ids.create(),
          actor,
          subjectId: created.id,
          subjectKind: "item_result",
          action: "item_result.recorded",
          afterValues: {
            inspectionId,
            inspectionRoomId,
            itemId: input.itemId,
            result: input.result,
          },
          occurredAt,
        }),
      );
      if (completed) {
        await inspections.appendAudit(
          audit({
            id: this.ids.create(),
            actor,
            subjectId: inspectionId,
            action: "inspection.completed",
            afterValues: { status: "awaiting_decisions" },
            occurredAt,
          }),
        );
      }
      return toItemResultDto({
        ...created,
        result: input.result,
        comment,
        revisionNumber: 1,
      });
    });
  }

  private async toDto(
    record: InspectionRecord,
    repository?: InventoryInspectionRepository,
  ): Promise<InspectionDto> {
    const rooms = repository
      ? await repository.listRooms(record.id)
      : await this.unitOfWork.read(({ inspections }) =>
          inspections.listRooms(record.id),
        );
    const results = repository
      ? await repository.listItemResults(record.id)
      : await this.unitOfWork.read(({ inspections }) =>
          inspections.listItemResults(record.id),
        );
    const items = repository
      ? await repository.listExpectedItems(record.id)
      : await this.unitOfWork.read(({ inspections }) =>
          inspections.listExpectedItems(record.id),
        );
    const expectedIds = new Set(items.map((item) => item.itemId));
    const expectedResults = results.filter((result) => expectedIds.has(result.itemId));
    const checked = expectedResults.length;
    const total = items.length;
    const overdue =
      record.status === "draft" &&
      this.clock.now().getTime() > record.deadlineAt.getTime();
    return {
      id: record.id,
      name: record.name,
      technicianId: record.technicianId,
      status: record.status,
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      deadlineAt: record.deadlineAt.toISOString(),
      rooms: rooms.map(toRoomDto),
      items: items.map((item) => ({
        inspectionRoomId: item.inspectionRoomId,
        itemId: item.itemId,
        itemName: item.itemName,
        inventoryNumber: item.inventoryNumber,
        buildingName: item.buildingName,
        roomDesignation: item.roomDesignation,
      })),
      results: results.map(toItemResultDto),
      progress: {
        checked,
        total,
        percent: total ? Math.round((checked / total) * 100) : 0,
        present: expectedResults.filter((result) => result.result === "present").length,
        missing: expectedResults.filter((result) => result.result === "missing").length,
        unchecked: Math.max(0, total - checked),
        comments: expectedResults.filter((result) => result.comment !== null).length,
      },
      displayStatus:
        record.status === "awaiting_decisions" || record.status === "confirmed"
          ? "completed"
          : overdue
            ? "overdue"
            : checked > 0
              ? "in_progress"
              : "draft",
    };
  }
}

function normalizeName(value: unknown) {
  if (typeof value !== "string") {
    throw new ApplicationError("validation", "invalid_inspection_name");
  }
  const name = value.normalize("NFKC").trim();
  if (!name || [...name].length > 120) {
    throw new ApplicationError("validation", "invalid_inspection_name");
  }
  return name;
}

function normalizeTechnicianId(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApplicationError("validation", "invalid_technician_id");
  }
  return value;
}

function normalizeDeadline(value: unknown, createdAt: Date) {
  if (value === undefined || value === null || value === "") {
    return new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1_000);
  }
  if (typeof value !== "string") {
    throw new ApplicationError("validation", "invalid_inspection_deadline");
  }
  const deadline = new Date(value);
  if (!Number.isFinite(deadline.getTime()) || deadline <= createdAt) {
    throw new ApplicationError("validation", "invalid_inspection_deadline");
  }
  return deadline;
}

function forbidden() {
  return new ApplicationError("forbidden", "forbidden");
}

function notFound(code: string) {
  return new ApplicationError("not_found", code);
}

function audit(input: {
  id: string;
  actor: AuthorizationActor;
  subjectId: string;
  subjectKind?: "inspection" | "item_result";
  action: string;
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  occurredAt: Date;
}): AppendInspectionAuditRecord {
  return {
    ...input,
    actorId: input.actor.userId,
    actorRole: input.actor.role,
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
    subjectKind: input.subjectKind ?? "inspection",
  };
}

function normalizeOptionalComment(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApplicationError("validation", "invalid_comment");
  }
  const comment = value.normalize("NFKC").trim();
  if (!comment || [...comment].length > 1_000) {
    throw new ApplicationError("validation", "invalid_comment");
  }
  return comment;
}

function postgresConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function toItemResultDto(record: {
  id: string;
  inspectionId: string;
  inspectionRoomId: string;
  itemId: string;
  itemNameSnapshot: string;
  inventoryNumberSnapshot: string;
  registryRoomIdAtScan: string;
  responsibleIdAtScan: string | null;
  result: import("@/lib/contracts/inventory-domain").ItemResultValue;
  comment: string | null;
  revisionNumber: number;
  createdAt: Date;
}): ItemResultDto {
  return {
    id: record.id,
    inspectionId: record.inspectionId,
    inspectionRoomId: record.inspectionRoomId,
    itemId: record.itemId,
    itemName: record.itemNameSnapshot,
    inventoryNumber: record.inventoryNumberSnapshot,
    registryRoomIdAtScan: record.registryRoomIdAtScan,
    responsibleIdAtScan: record.responsibleIdAtScan,
    result: record.result,
    comment: record.comment,
    revisionNumber: record.revisionNumber,
    createdAt: record.createdAt.toISOString(),
  };
}

function toRoomDto(room: {
  id: string;
  buildingId: string;
  roomId: string;
  buildingName: string;
  buildingAddress: string;
  roomDesignation: string;
  floorNumber: number;
  floorLabel: string | null;
  addedAt: Date;
  inspectedAt: Date | null;
}): InspectionRoomDto {
  return {
    id: room.id,
    buildingId: room.buildingId,
    roomId: room.roomId,
    buildingName: room.buildingName,
    buildingAddress: room.buildingAddress,
    roomDesignation: room.roomDesignation,
    floorNumber: room.floorNumber,
    floorLabel: room.floorLabel,
    addedAt: room.addedAt.toISOString(),
    inspectedAt: room.inspectedAt?.toISOString() ?? null,
  };
}
