import type { ServiceRequestRepositories } from "@/lib/application/ports/service-request-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type {
  CreateServiceRequestInput,
  ServiceRequestDto,
  ServiceRequestFilters,
} from "@/lib/contracts/service-requests";
import type { ServiceRequestStatus } from "@/lib/contracts/inventory-domain";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import type { AuthorizationActor } from "@/lib/security/permissions";

type AuthenticatedServiceRequestActor = AuthorizationActor & {
  sessionVersion: number;
};

export interface ServiceRequestPhotoProcessor {
  normalize(imageDataUrl: unknown): Promise<{
    bytes: Uint8Array;
    width: number;
    height: number;
    mediaType: "image/jpeg";
  }>;
}

export class ServiceRequestService {
  constructor(
    private readonly unitOfWork: UnitOfWork<ServiceRequestRepositories>,
    private readonly clock: { now(): Date },
    private readonly ids: { create(): string },
    private readonly photos: ServiceRequestPhotoProcessor,
  ) {}

  async list(
    filters: ServiceRequestFilters,
    actor: AuthenticatedServiceRequestActor,
  ) {
    assertAuthenticatedActor(actor);
    if (
      actor.role !== "admin" &&
      actor.role !== "warehouse" &&
      actor.role !== "employee"
    ) {
      throw forbidden();
    }
    return this.unitOfWork.read(async ({ requests }) =>
      (await requests.list(filters, actor)).map(toDto),
    );
  }

  async create(
    input: CreateServiceRequestInput,
    actor: AuthenticatedServiceRequestActor,
  ) {
    assertAuthenticatedActor(actor);
    if (actor.role !== "admin" && actor.role !== "employee") throw forbidden();
    if (!isUuid(input.itemId)) throw validation();
    if (![
      "not_working",
      "not_connected",
      "damaged",
      "missing",
    ].includes(input.type)) throw validation();
    const description = normalizeDescription(input.description);
    await this.unitOfWork.read(async ({ requests }) => {
      const context = await requests.findItemContext(input.itemId);
      if (!context) throw new ApplicationError("not_found", "item_not_found");
      if (
        actor.role === "employee" &&
        context.roomResponsibleId !== actor.userId &&
        context.itemResponsibleId !== actor.userId
      ) {
        throw itemNotFound();
      }
    });
    const photo = await this.photos.normalize(input.photo?.imageDataUrl);
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ requests }) => {
      const authorization = await requests.findCreateAuthorizationForUpdate(
        input.itemId,
        actor.userId,
      );
      const currentActor = authorization.actor;
      if (
        !currentActor ||
        !currentActor.active ||
        currentActor.deletedAt ||
        currentActor.version !== actor.sessionVersion ||
        currentActor.role !== actor.role
      ) {
        throw unauthorized();
      }
      const context = authorization.item;
      if (!context) throw itemNotFound();
      if (
        actor.role === "employee" &&
        context.roomResponsibleId !== actor.userId &&
        context.itemResponsibleId !== actor.userId
      ) {
        throw itemNotFound();
      }
      const id = this.ids.create();
      const created = await requests.insert({
        id,
        itemId: input.itemId,
        roomId: context.roomId,
        authorId: actor.userId,
        type: input.type,
        description,
        photoBytes: photo.bytes,
        photoWidth: photo.width,
        photoHeight: photo.height,
        occurredAt,
      });
      await requests.appendAudit({
        id: this.ids.create(),
        actorId: actor.userId,
        actorRole: actor.role,
        subjectId: id,
        subjectRevision: 1,
        action: "service_request.created",
        beforeValues: null,
        afterValues: { itemId: input.itemId, type: input.type, status: "new" },
        occurredAt,
      });
      return toDto(created);
    });
  }

  async updateStatus(
    id: string,
    status: ServiceRequestStatus,
    version: number,
    actor: AuthenticatedServiceRequestActor,
  ) {
    assertAuthenticatedActor(actor);
    if (actor.role !== "admin") throw forbidden();
    if (
      !isUuid(id) ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      version > 2_147_483_647
    ) throw validation();
    if (!["new", "in_progress", "completed"].includes(status)) throw validation();
    const normalizedId = id.toLowerCase();
    const normalizedActorId = actor.userId.toLowerCase();
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ requests }) => {
      const currentActor = await requests.findAuthorizationUserForUpdate(
        normalizedActorId,
      );
      if (
        !currentActor ||
        currentActor.id.toLowerCase() !== normalizedActorId ||
        !currentActor.active ||
        currentActor.deletedAt ||
        currentActor.version !== actor.sessionVersion ||
        currentActor.role !== actor.role ||
        currentActor.role !== "admin"
      ) {
        throw unauthorized();
      }
      const current = await requests.findByIdForUpdate(normalizedId);
      if (!current) throw new ApplicationError("not_found", "service_request_not_found");
      if (current.version !== version) throw new ApplicationError("conflict", "version_conflict");
      const updated = await requests.updateStatus({
        id: normalizedId,
        status,
        expectedStatus: current.status,
        actorId: normalizedActorId,
        actorRole: currentActor.role,
        actorSessionVersion: actor.sessionVersion,
        expectedVersion: version,
        occurredAt,
      });
      if (
        !updated ||
        updated.id.toLowerCase() !== normalizedId ||
        updated.status !== status ||
        updated.version !== version + 1
      ) {
        throw new ApplicationError("conflict", "version_conflict");
      }
      await requests.appendAudit({
        id: this.ids.create(),
        actorId: currentActor.id.toLowerCase(),
        actorRole: currentActor.role,
        subjectId: normalizedId,
        subjectRevision: updated.version,
        action: "service_request.status_changed",
        beforeValues: { status: current.status },
        afterValues: { status: updated.status },
        occurredAt,
      });
      return toDto(updated);
    });
  }

  async getPhoto(id: string, actor: AuthenticatedServiceRequestActor) {
    assertAuthenticatedActor(actor);
    if (!isUuid(id)) throw validation();
    const normalizedId = id.toLowerCase();
    const normalizedActorId = actor.userId.toLowerCase();
    return this.unitOfWork.transaction(async ({ requests }) => {
      const currentActor = await requests.findAuthorizationUserForUpdate(
        normalizedActorId,
      );
      if (
        !currentActor ||
        currentActor.id.toLowerCase() !== normalizedActorId ||
        !currentActor.active ||
        currentActor.deletedAt ||
        currentActor.version !== actor.sessionVersion ||
        currentActor.role !== actor.role
      ) {
        throw unauthorized();
      }
      const request = await requests.findByIdForUpdate(normalizedId);
      if (!request || !canRead(request, { userId: normalizedActorId, role: currentActor.role })) {
        throw new ApplicationError("not_found", "service_request_not_found");
      }
      const photo = await requests.findPhoto(normalizedId);
      if (!photo) throw new ApplicationError("not_found", "service_request_photo_not_found");
      return photo;
    });
  }
}

function canRead(
  request: Awaited<ReturnType<ServiceRequestRepositories["requests"]["findById"]>> & {},
  actor: AuthorizationActor,
) {
  return actor.role === "admin" || actor.role === "warehouse" ||
    request.roomResponsibleId === actor.userId ||
    request.itemResponsibleId === actor.userId;
}

function toDto(record: NonNullable<Awaited<ReturnType<ServiceRequestRepositories["requests"]["findById"]>>>): ServiceRequestDto {
  return {
    id: record.id,
    item: { id: record.itemId, name: record.itemName, inventoryNumber: record.inventoryNumber },
    room: { id: record.roomId, designation: record.roomDesignation, buildingName: record.buildingName },
    author: { id: record.authorId, name: record.authorName },
    responsible: record.responsibleId
      ? { id: record.responsibleId, name: record.responsibleName ?? "" }
      : null,
    type: record.type,
    description: record.description,
    status: record.status,
    photoUrl: `/api/service-requests/${record.id}/photo?v=${record.version}`,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    version: record.version,
  };
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") throw validation();
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || [...normalized].length > 4000) throw validation();
  return normalized;
}

function validation() {
  return new ApplicationError("validation", "invalid_service_request");
}

function forbidden() {
  return new ApplicationError("forbidden", "forbidden");
}

function itemNotFound() {
  return new ApplicationError("not_found", "item_not_found");
}

function unauthorized() {
  return new ApplicationError("unauthorized", "unauthorized");
}

function assertAuthenticatedActor(actor: AuthenticatedServiceRequestActor) {
  if (
    !isUuid(actor.userId) ||
    !Number.isSafeInteger(actor.sessionVersion) ||
    actor.sessionVersion < 1
  ) {
    throw unauthorized();
  }
}
