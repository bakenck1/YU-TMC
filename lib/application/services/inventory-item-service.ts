import type {
  CreateInventoryItemInput,
  InventoryItemDto,
  UpdateInventoryItemContentInput,
  UpdateInventoryItemProtectedInput,
} from "@/lib/contracts/inventory-items";
import type {
  AppendItemAuditRecord,
  InventoryItemRecord,
  InventoryItemRepositories,
} from "@/lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { qrIdentifierFromEntropy } from "@/lib/domain/qr-identifier";
import {
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";
import type { ItemStatus } from "@/lib/contracts/inventory-domain";

export interface InventoryItemClock {
  now(): Date;
}

export interface InventoryItemIds {
  create(): string;
}

export interface InventoryItemQrEntropy {
  create(): Uint8Array;
}

export interface TemporaryNumberSource {
  next(year: number): string;
}

export interface SendItemToServiceInput {
  serviceName: string;
  reason: string;
}

export class InventoryItemService {
  constructor(
    private readonly unitOfWork: UnitOfWork<InventoryItemRepositories>,
    private readonly clock: InventoryItemClock,
    private readonly ids: InventoryItemIds,
    private readonly qrEntropy: InventoryItemQrEntropy,
    private readonly temporaryNumbers: TemporaryNumberSource,
  ) {}

  async listItems(actor: AuthorizationActor): Promise<InventoryItemDto[]> {
    const repositories = await this.unitOfWork.read(async (repos) => {
      if (hasPermission(actor.role, "inventory.item.read_all")) {
        return repos.items.listItems();
      }
      if (hasPermission(actor.role, "inventory.item.read_assigned")) {
        return repos.items.listItemsAssignedTo(actor.userId);
      }
      throw forbidden();
    });
    return repositories.map(toItemDto);
  }

  async findItem(
    id: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    const item = await this.unitOfWork.read(async ({ items }) => {
      const value = await items.findItemById(id);
      if (!value) throw new ApplicationError("not_found", "item_not_found");
      if (
        !hasPermission(actor.role, "inventory.item.read_all") &&
        !(
          hasPermission(actor.role, "inventory.item.read_assigned") &&
          value.responsibleId === actor.userId
        )
      ) {
        throw forbidden();
      }
      return value;
    });
    return toItemDto(item);
  }

  async createItem(
    input: CreateInventoryItemInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.create");
    const values = normalizeCreateInput(input);
    const occurredAt = this.clock.now();
    const itemId = this.ids.create();
    const qrId = this.ids.create();
    const auditId = this.ids.create();
    const inventoryNumber = values.inventoryNumber
      ? values.inventoryNumber
      : this.temporaryNumbers.next(occurredAt.getUTCFullYear());
    const inventoryNumberKind = values.inventoryNumber ? "official" : "temporary";
    const qrCode = qrIdentifierFromEntropy(this.qrEntropy.create());

    return this.unitOfWork.transaction(async ({ items }) => {
      if (!(await items.roomExists(values.roomId))) {
        throw new ApplicationError("not_found", "room_not_found");
      }
      const created = await items.insertItem({
        id: itemId,
        name: values.name,
        description: values.description,
        itemType: values.itemType,
        brand: values.brand,
        model: values.model,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        roomId: values.roomId,
        inventoryNumberKind,
        inventoryNumber,
        inventoryNumberKey: comparisonKey(inventoryNumber),
        actorId: actor.userId,
        occurredAt,
      });
      await items.insertItemQr({
        id: qrId,
        itemId,
        value: qrCode,
        actorId: actor.userId,
      });
      await items.appendAudit(
        createAudit({
          id: auditId,
          actor,
          subjectId: itemId,
          subjectRevision: created.version,
          action: "item.created",
          afterValues: {
            name: created.name,
            description: created.description,
            itemType: created.itemType,
            brand: created.brand,
            model: created.model,
            quantity: created.quantity,
            unitPrice: created.unitPrice,
            roomId: created.roomId,
            inventoryNumber: created.inventoryNumber,
            inventoryNumberKind: created.inventoryNumberKind,
            qrIdentifierId: qrId,
          },
          occurredAt,
        }),
      );
      return toItemDto({ ...created, qrCode });
    });
  }

  async updateContent(
    id: string,
    input: UpdateInventoryItemContentInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.edit_content");
    const patch = normalizeContentInput(input);
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== input.version) throw versionConflict();
      const values = {
        name: patch.name,
        description: patch.description,
        itemType: patch.itemType ?? current.itemType,
        brand: patch.brand === undefined ? current.brand : patch.brand,
        model: patch.model === undefined ? current.model : patch.model,
        quantity: patch.quantity ?? current.quantity,
        unitPrice: patch.unitPrice ?? current.unitPrice,
      };
      const updated = await items.updateItemContent({
        id,
        ...values,
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt: this.clock.now(),
      });
      if (!updated) throw versionConflict();
      await items.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectId: id,
          subjectRevision: updated.version,
          action: "item.content_updated",
          beforeValues: itemContentAuditValues(current),
          afterValues: itemContentAuditValues(updated),
          occurredAt: this.clock.now(),
        }),
      );
      return toItemDto({ ...updated, qrCode: current.qrCode });
    });
  }

  async updateProtected(
    id: string,
    input: UpdateInventoryItemProtectedInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.manage_protected_fields");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const values = normalizeProtectedInput(input);
    const replaceQr = input.replaceQr === true;
    const qrReplaceReason = replaceQr
      ? normalizeText(input.qrReplaceReason, 1_000, "qr_replace_reason_required")
      : null;
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== input.version) throw versionConflict();
      if (!(await items.roomExists(values.roomId))) {
        throw new ApplicationError("not_found", "room_not_found");
      }
      const updated = await items.updateItemProtected({
        id,
        ...values,
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt: this.clock.now(),
      });
      if (!updated) throw versionConflict();
      let qrCode = current.qrCode;
      if (replaceQr) {
        qrCode = qrIdentifierFromEntropy(this.qrEntropy.create());
        await items.replaceItemQr({
          id: this.ids.create(),
          itemId: id,
          value: qrCode,
          actorId: actor.userId,
          revokedAt: this.clock.now(),
          revokeReason: qrReplaceReason!,
        });
      }
      await items.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectId: id,
          subjectRevision: updated.version,
          action: "item.protected_fields_updated",
          beforeValues: {
            roomId: current.roomId,
            inventoryNumber: current.inventoryNumber,
            status: current.status,
            qrCode: current.qrCode,
          },
          afterValues: {
            roomId: updated.roomId,
            inventoryNumber: updated.inventoryNumber,
            status: updated.status,
            qrCode,
            qrReplaceReason,
          },
          occurredAt: this.clock.now(),
        }),
      );
      return toItemDto({ ...updated, qrCode });
    });
  }

  async archiveItem(
    id: string,
    version: number,
    actor: AuthorizationActor,
  ): Promise<void> {
    requirePermission(actor, "inventory.item.manage_protected_fields");
    if (!Number.isInteger(version) || version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const occurredAt = this.clock.now();
    await this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== version) throw versionConflict();
      const archived = await items.archiveItem({
        id,
        actorId: actor.userId,
        expectedVersion: version,
        occurredAt,
      });
      if (!archived) throw versionConflict();
      await items.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectId: id,
          subjectRevision: archived.version,
          action: "item.archived",
          beforeValues: { status: current.status, name: current.name },
          afterValues: { status: archived.status, name: archived.name },
          occurredAt,
        }),
      );
    });
  }

  async sendToService(
    id: string,
    version: number,
    input: SendItemToServiceInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.send_to_service");
    if (!Number.isInteger(version) || version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const service = normalizeServiceInput(input);
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== version) throw versionConflict();
      const updated = await items.updateItemStatus({
        id,
        status: "maintenance",
        actorId: actor.userId,
        expectedVersion: version,
        occurredAt,
      });
      if (!updated) throw versionConflict();
      await items.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectId: id,
          subjectRevision: updated.version,
          action: "item.sent_to_service",
          beforeValues: { status: current.status },
          afterValues: {
            status: updated.status,
            serviceName: service.serviceName,
            reason: service.reason,
          },
          occurredAt,
        }),
      );
      return toItemDto({ ...updated, qrCode: current.qrCode });
    });
  }
}

function normalizeCreateInput(input: CreateInventoryItemInput) {
  const content = normalizeContentInput({ version: 1, ...input });
  const roomId = normalizeId(input.roomId, "invalid_room_id");
  const inventoryNumber =
    input.inventoryNumber === undefined || input.inventoryNumber === null
      ? null
      : normalizeText(input.inventoryNumber, 64, "invalid_inventory_number");
  return {
    ...content,
    itemType: content.itemType ?? "ТМЦ",
    brand: content.brand ?? null,
    model: content.model ?? null,
    quantity: content.quantity ?? 1,
    unitPrice: content.unitPrice ?? 0,
    roomId,
    inventoryNumber,
  };
}

function normalizeContentInput(input: {
  version: unknown;
  name: unknown;
  description?: unknown;
  itemType?: unknown;
  brand?: unknown;
  model?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
}) {
  if (!Number.isInteger(input.version) || Number(input.version) < 1) {
    throw new ApplicationError("validation", "invalid_version");
  }
  const name = normalizeText(input.name, 160, "invalid_item_name");
  const description =
    input.description === undefined || input.description === null
      ? null
      : normalizeText(input.description, 4_000, "invalid_item_description");
  return {
    name,
    description,
    itemType: normalizeOptionalText(input.itemType, 120, "invalid_item_type"),
    brand: normalizeOptionalText(input.brand, 120, "invalid_item_brand"),
    model: normalizeOptionalText(input.model, 160, "invalid_item_model"),
    quantity: normalizeOptionalPositiveInteger(input.quantity),
    unitPrice: normalizeOptionalPrice(input.unitPrice),
  };
}

function normalizeOptionalText(value: unknown, max: number, code: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeText(value, max, code);
}

function normalizeOptionalPositiveInteger(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 1_000_000) {
    throw new ApplicationError("validation", "invalid_item_quantity");
  }
  return value;
}

function normalizeOptionalPrice(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 999_999_999_999.99) {
    throw new ApplicationError("validation", "invalid_item_price");
  }
  return Math.round(value * 100) / 100;
}

function normalizeProtectedInput(input: UpdateInventoryItemProtectedInput) {
  return {
    roomId: normalizeId(input.roomId, "invalid_room_id"),
    inventoryNumberKind: "official" as const,
    inventoryNumber: normalizeText(
      input.inventoryNumber,
      64,
      "invalid_inventory_number",
    ),
    inventoryNumberKey: comparisonKey(input.inventoryNumber),
    status: normalizeStatus(input.status),
  };
}

function normalizeServiceInput(input: SendItemToServiceInput) {
  return {
    serviceName: normalizeText(input.serviceName, 160, "invalid_service_name"),
    reason: normalizeText(input.reason, 1_000, "invalid_service_reason"),
  };
}

function normalizeText(value: unknown, max: number, code: string) {
  if (typeof value !== "string") throw new ApplicationError("validation", code);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || [...normalized].length > max) {
    throw new ApplicationError("validation", code);
  }
  return normalized;
}

function normalizeId(value: unknown, code: string) {
  const normalized = normalizeText(value, 64, code);
  if (!/^[0-9a-f-]{36}$/i.test(normalized)) {
    throw new ApplicationError("validation", code);
  }
  return normalized;
}

function normalizeStatus(value: unknown): ItemStatus {
  if (value === "active" || value === "maintenance" || value === "decommissioned") {
    return value;
  }
  throw new ApplicationError("validation", "invalid_item_status");
}

function comparisonKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
}

function requirePermission(
  actor: AuthorizationActor,
  permission:
    | "inventory.item.create"
    | "inventory.item.edit_content"
    | "inventory.item.send_to_service"
    | "inventory.item.manage_protected_fields",
) {
  if (!hasPermission(actor.role, permission)) throw forbidden();
}

function forbidden() {
  return new ApplicationError("forbidden", "forbidden");
}

function versionConflict() {
  return new ApplicationError("conflict", "version_conflict");
}

function createAudit(input: {
  id: string;
  actor: AuthorizationActor;
  subjectId: string;
  subjectRevision: number;
  action: string;
  beforeValues?: Record<string, unknown>;
  afterValues?: Record<string, unknown>;
  occurredAt: Date;
}): AppendItemAuditRecord {
  return {
    id: input.id,
    actorId: input.actor.userId,
    actorRole: input.actor.role,
    subjectId: input.subjectId,
    subjectRevision: input.subjectRevision,
    action: input.action,
    beforeValues: input.beforeValues ?? null,
    afterValues: input.afterValues ?? null,
    occurredAt: input.occurredAt,
  };
}

function toItemDto(record: InventoryItemRecord): InventoryItemDto {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    itemType: record.itemType,
    brand: record.brand,
    model: record.model,
    quantity: record.quantity,
    unitPrice: record.unitPrice,
    inventoryNumberKind: record.inventoryNumberKind,
    inventoryNumber: record.inventoryNumber,
    room: {
      id: record.roomId,
      designation: record.roomDesignation,
      floorNumber: record.floorNumber,
      buildingId: record.buildingId,
      buildingName: record.buildingName,
    },
    status: record.status,
    qrCode: record.qrCode,
    responsible: record.responsibleId
      ? { id: record.responsibleId, name: record.responsibleName ?? "" }
      : null,
    photoUrl: record.photoUrl,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function itemContentAuditValues(record: InventoryItemRecord) {
  return {
    name: record.name,
    description: record.description,
    itemType: record.itemType,
    brand: record.brand,
    model: record.model,
    quantity: record.quantity,
    unitPrice: record.unitPrice,
  };
}
