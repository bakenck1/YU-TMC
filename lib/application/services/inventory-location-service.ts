import type {
  BuildingDto,
  CreateBuildingInput,
  CreateRoomInput,
  RoomDto,
  UpdateBuildingInput,
  UpdateRoomInput,
} from "@/lib/contracts/inventory-locations";
import type {
  AppendLocationAuditRecord,
  BuildingRecord,
  InventoryLocationRepositories,
  RoomRecord,
} from "@/lib/application/ports/inventory-location-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { qrIdentifierFromEntropy } from "@/lib/domain/qr-identifier";
import {
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

export interface LocationServiceClock {
  now(): Date;
}

export interface LocationServiceIds {
  create(): string;
}

export interface QrEntropySource {
  create(): Uint8Array;
}

export class InventoryLocationService {
  constructor(
    private readonly unitOfWork: UnitOfWork<InventoryLocationRepositories>,
    private readonly clock: LocationServiceClock,
    private readonly ids: LocationServiceIds,
    private readonly qrEntropy: QrEntropySource,
  ) {}

  async listBuildings(actor: AuthorizationActor): Promise<BuildingDto[]> {
    requirePermission(actor, "inventory.workspace.read");
    return this.unitOfWork.read(async ({ locations }) =>
      (await locations.listBuildings()).map(toBuildingDto),
    );
  }

  async createBuilding(
    input: CreateBuildingInput,
    actor: AuthorizationActor,
  ): Promise<BuildingDto> {
    requirePermission(actor, "inventory.building.create");
    const values = normalizeBuildingInput(input);
    const occurredAt = this.clock.now();
    const buildingId = this.ids.create();
    const qrId = this.ids.create();
    const auditId = this.ids.create();
    const qrCode = qrIdentifierFromEntropy(this.qrEntropy.create());

    return this.unitOfWork.transaction(async ({ locations }) => {
      const building = await locations.insertBuilding({
        id: buildingId,
        ...values,
        actorId: actor.userId,
        occurredAt,
      });
      await locations.insertBuildingQr({
        id: qrId,
        buildingId,
        value: qrCode,
        actorId: actor.userId,
      });
      await locations.appendAudit(
        createAudit({
          id: auditId,
          actor,
          subjectId: buildingId,
          action: "building.created",
          afterValues: {
            address: building.address,
            name: building.name,
            qrIdentifierId: qrId,
          },
          occurredAt,
        }),
      );
      return toBuildingDto({ ...building, qrCode });
    });
  }

  async updateBuilding(
    id: string,
    input: UpdateBuildingInput,
    actor: AuthorizationActor,
  ): Promise<BuildingDto> {
    requirePermission(actor, "inventory.building.manage");
    const values = normalizeBuildingInput(input);
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const occurredAt = this.clock.now();
    const auditId = this.ids.create();

    return this.unitOfWork.transaction(async ({ locations }) => {
      const current = await locations.findBuildingById(id);
      if (!current) {
        throw new ApplicationError("not_found", "building_not_found");
      }
      if (current.version !== input.version) {
        throw new ApplicationError("conflict", "version_conflict");
      }
      const updated = await locations.updateBuilding({
        id,
        ...values,
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt,
      });
      if (!updated) {
        throw new ApplicationError("conflict", "version_conflict");
      }
      const updatedWithRelations = {
        ...updated,
        qrCode: current.qrCode,
        roomCount: current.roomCount,
      };
      await locations.appendAudit(
        createAudit({
          id: auditId,
          actor,
          subjectId: id,
          subjectRevision: updated.version,
          action: "building.updated",
          beforeValues: {
            address: current.address,
            name: current.name,
          },
          afterValues: {
            address: updatedWithRelations.address,
            name: updatedWithRelations.name,
          },
          occurredAt,
        }),
      );
      return toBuildingDto(updatedWithRelations);
    });
  }

  async archiveBuilding(
    id: string,
    version: number,
    actor: AuthorizationActor,
  ): Promise<void> {
    requirePermission(actor, "inventory.building.manage");
    requireVersion(version);
    const occurredAt = this.clock.now();
    await this.unitOfWork.transaction(async ({ locations }) => {
      const current = await locations.findBuildingById(id);
      if (!current) throw new ApplicationError("not_found", "building_not_found");
      if (current.version !== version) throw versionConflict();
      if ((await locations.countActiveRooms(id)) > 0) {
        throw new ApplicationError("conflict", "building_has_active_rooms");
      }
      const archived = await locations.archiveBuilding({
        id,
        actorId: actor.userId,
        expectedVersion: version,
        occurredAt,
      });
      if (!archived) throw versionConflict();
      await locations.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectId: id,
          subjectRevision: archived.version,
          action: "building.archived",
          beforeValues: { name: current.name, status: current.status },
          afterValues: { name: archived.name, status: archived.status },
          occurredAt,
        }),
      );
    });
  }

  async listRooms(
    buildingId: string,
    actor: AuthorizationActor,
  ): Promise<RoomDto[]> {
    requirePermission(actor, "inventory.workspace.read");
    return this.unitOfWork.read(async ({ locations }) => {
      const building = await locations.findBuildingById(buildingId);
      if (!building || building.status !== "active") {
        throw new ApplicationError("not_found", "building_not_found");
      }
      return (await locations.listRooms(buildingId)).map(toRoomDto);
    });
  }

  async createRoom(
    buildingId: string,
    input: CreateRoomInput,
    actor: AuthorizationActor,
  ): Promise<RoomDto> {
    requirePermission(actor, "inventory.room.create");
    const values = normalizeRoomInput(input);
    const occurredAt = this.clock.now();
    const roomId = this.ids.create();
    const qrId = this.ids.create();
    const auditId = this.ids.create();
    const qrCode = qrIdentifierFromEntropy(this.qrEntropy.create());

    return this.unitOfWork.transaction(async ({ locations }) => {
      const building = await locations.findBuildingById(buildingId);
      if (!building || building.status !== "active") {
        throw new ApplicationError("not_found", "building_not_found");
      }
      const room = await locations.insertRoom({
        id: roomId,
        buildingId,
        ...values,
        actorId: actor.userId,
        occurredAt,
      });
      await locations.insertRoomQr({
        id: qrId,
        roomId,
        value: qrCode,
        actorId: actor.userId,
      });
      await locations.appendAudit(
        createAudit({
          id: auditId,
          actor,
          subjectKind: "room",
          subjectId: roomId,
          action: "room.created",
          afterValues: {
            buildingId,
            designation: room.designation,
            floorNumber: room.floorNumber,
            qrIdentifierId: qrId,
          },
          occurredAt,
        }),
      );
      return toRoomDto({ ...room, qrCode });
    });
  }

  async updateRoom(
    id: string,
    input: UpdateRoomInput,
    actor: AuthorizationActor,
  ): Promise<RoomDto> {
    requirePermission(actor, "inventory.room.manage");
    const values = normalizeRoomInput(input);
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const occurredAt = this.clock.now();
    const auditId = this.ids.create();

    return this.unitOfWork.transaction(async ({ locations }) => {
      const current = await locations.findRoomById(id);
      if (!current) throw new ApplicationError("not_found", "room_not_found");
      if (current.version !== input.version) {
        throw new ApplicationError("conflict", "version_conflict");
      }
      const updated = await locations.updateRoom({
        id,
        ...values,
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt,
      });
      if (!updated) throw new ApplicationError("conflict", "version_conflict");
      const updatedWithRelations = {
        ...updated,
        qrCode: current.qrCode,
      };
      await locations.appendAudit(
        createAudit({
          id: auditId,
          actor,
          subjectKind: "room",
          subjectId: id,
          subjectRevision: updated.version,
          action: "room.updated",
          beforeValues: {
            designation: current.designation,
            floorNumber: current.floorNumber,
            floorLabel: current.floorLabel,
          },
          afterValues: {
            designation: updated.designation,
            floorNumber: updated.floorNumber,
            floorLabel: updated.floorLabel,
          },
          occurredAt,
        }),
      );
      return toRoomDto(updatedWithRelations);
    });
  }

  async archiveRoom(
    id: string,
    version: number,
    actor: AuthorizationActor,
  ): Promise<void> {
    requirePermission(actor, "inventory.room.manage");
    requireVersion(version);
    const occurredAt = this.clock.now();
    await this.unitOfWork.transaction(async ({ locations }) => {
      const current = await locations.findRoomById(id);
      if (!current) throw new ApplicationError("not_found", "room_not_found");
      if (current.version !== version) throw versionConflict();
      if ((await locations.countActiveItems(id)) > 0) {
        throw new ApplicationError("conflict", "room_has_active_items");
      }
      const archived = await locations.archiveRoom({
        id,
        actorId: actor.userId,
        expectedVersion: version,
        occurredAt,
      });
      if (!archived) throw versionConflict();
      await locations.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectKind: "room",
          subjectId: id,
          subjectRevision: archived.version,
          action: "room.archived",
          beforeValues: { designation: current.designation, status: current.status },
          afterValues: { designation: archived.designation, status: archived.status },
          occurredAt,
        }),
      );
    });
  }
}

function normalizeBuildingInput(input: {
  name: unknown;
  address: unknown;
}) {
  const name = normalizeRequiredText(input.name, 120, "invalid_building_name");
  const address = normalizeRequiredText(
    input.address,
    300,
    "invalid_building_address",
  );
  return {
    name,
    nameKey: comparisonKey(name),
    address,
    addressKey: comparisonKey(address),
  };
}

function requireVersion(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ApplicationError("validation", "invalid_version");
  }
}

function versionConflict() {
  return new ApplicationError("conflict", "version_conflict");
}

function normalizeRequiredText(
  value: unknown,
  maximumLength: number,
  publicCode: string,
) {
  if (typeof value !== "string") {
    throw new ApplicationError("validation", publicCode);
  }
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || [...normalized].length > maximumLength) {
    throw new ApplicationError("validation", publicCode);
  }
  return normalized;
}

function normalizeRoomInput(input: {
  designation: unknown;
  floorNumber: unknown;
  floorLabel?: unknown;
}) {
  const designation = normalizeRequiredText(
    input.designation,
    80,
    "invalid_room_designation",
  );
  if (
    typeof input.floorNumber !== "number" ||
    !Number.isInteger(input.floorNumber) ||
    input.floorNumber < -5 ||
    input.floorNumber > 200
  ) {
    throw new ApplicationError("validation", "invalid_room_floor");
  }
  let floorLabel: string | null = null;
  if (input.floorLabel !== undefined && input.floorLabel !== null) {
    floorLabel = normalizeRequiredText(
      input.floorLabel,
      40,
      "invalid_room_floor_label",
    );
  }
  return {
    designation,
    designationKey: comparisonKey(designation),
    floorNumber: input.floorNumber,
    floorLabel,
  };
}

function comparisonKey(value: string) {
  return value.toLocaleLowerCase("ru-RU");
}

function requirePermission(
  actor: AuthorizationActor,
  permission:
    | "inventory.workspace.read"
    | "inventory.building.create"
    | "inventory.building.manage"
    | "inventory.room.create"
    | "inventory.room.manage",
) {
  if (!hasPermission(actor.role, permission)) {
    throw new ApplicationError("forbidden", "forbidden");
  }
}

function createAudit(input: {
  id: string;
  actor: AuthorizationActor;
  subjectId: string;
  subjectKind?: "building" | "room";
  subjectRevision?: number;
  action: string;
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  occurredAt: Date;
}): AppendLocationAuditRecord {
  if (input.actor.role !== "admin" && input.actor.role !== "warehouse") {
    throw new ApplicationError("forbidden", "forbidden");
  }
  return {
    id: input.id,
    actorId: input.actor.userId,
    actorRole: input.actor.role,
    subjectKind: input.subjectKind ?? "building",
    subjectId: input.subjectId,
    subjectRevision: input.subjectRevision ?? 1,
    action: input.action,
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
    occurredAt: input.occurredAt,
  };
}

function toBuildingDto(record: BuildingRecord): BuildingDto {
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    qrCode: record.qrCode,
    roomCount: record.roomCount,
    status: record.status,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toRoomDto(record: RoomRecord): RoomDto {
  return {
    id: record.id,
    buildingId: record.buildingId,
    designation: record.designation,
    floorNumber: record.floorNumber,
    floorLabel: record.floorLabel,
    qrCode: record.qrCode,
    status: record.status,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
