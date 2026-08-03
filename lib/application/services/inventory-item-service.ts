import type {
  CreateInventoryItemInput,
  InventoryItemAuditDto,
  InventoryItemCommentDto,
  InventoryItemDto,
  InventoryItemOperationDto,
  UpdateInventoryItemContentInput,
  UpdateInventoryItemPhotoInput,
  UpdateInventoryItemProtectedInput,
} from "@/lib/contracts/inventory-items";
import type {
  AppendItemAuditRecord,
  InventoryItemAuditRecord,
  InventoryItemCommentRecord,
  InventoryItemOperationRecord,
  InventoryItemRecord,
  InventoryItemRepositories,
  StoredInventoryItemCommentAttachment,
  StoredItemPhoto,
} from "@/lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { qrIdentifierFromEntropy } from "@/lib/domain/qr-identifier";
import { inventoryNumberComparisonKey } from "@/lib/domain/code39";
import {
  canPerformInventoryOperation,
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";
import type { ItemStatus } from "@/lib/contracts/inventory-domain";
import sharp from "sharp";

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

export interface InventoryItemCommentAttachmentInput {
  fileName: unknown;
  mediaType: unknown;
  binaryData: Uint8Array;
}

export interface SendItemToServiceInput {
  serviceName: string;
  reason: string;
}

export interface ResolveMaintenanceItemInput {
  version: number;
  status: "active" | "decommissioned";
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
    // The repository query is already scoped to the employee's current
    // responsibility. Keep every lifecycle state in that scoped result so
    // the employee tabs and summary cards can show their own decommissioned
    // items as well.
    return repositories.map(toItemDto);
  }

  async listDecommissionedItems(
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto[]> {
    const records = await this.unitOfWork.read(async (repos) => {
      if (hasPermission(actor.role, "inventory.item.read_all")) {
        return repos.items.listDecommissionedItems();
      }
      if (hasPermission(actor.role, "inventory.item.read_assigned")) {
        return repos.items.listDecommissionedItemsAssignedTo(actor.userId);
      }
      throw forbidden();
    });
    return records.map(toItemDto);
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

  async listComponents(
    id: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto[]> {
    const normalizedId = normalizeItemId(id);
    const records = await this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(normalizedId);
      if (!item) throw new ApplicationError("not_found", "item_not_found");
      assertItemReadable(item, actor);
      const components = await items.listComponents(normalizedId);
      return hasPermission(actor.role, "inventory.item.read_all")
        ? components
        : components.filter(
            (component) => component.responsibleId === actor.userId,
          );
    });
    return records.map(toItemDto);
  }

  async addComponent(
    id: string,
    componentId: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto[]> {
    requirePermission(actor, "inventory.item.manage_components");
    const [leftItemId, rightItemId] = canonicalComponentPair(id, componentId);
    const occurredAt = this.clock.now();
    const records = await this.unitOfWork.transaction(async ({ items }) => {
      const [leftItem, rightItem] = await Promise.all([
        items.findItemById(leftItemId),
        items.findItemById(rightItemId),
      ]);
      if (!leftItem || !rightItem) {
        throw new ApplicationError("not_found", "item_not_found");
      }
      if (
        leftItem.status === "decommissioned" ||
        rightItem.status === "decommissioned"
      ) {
        throw new ApplicationError(
          "validation",
          "item_component_decommissioned",
        );
      }
      await items.insertComponent({
        leftItemId,
        rightItemId,
        actorId: actor.userId,
        occurredAt,
      });
      await appendComponentAudits(
        items,
        this.ids,
        actor,
        leftItem,
        rightItem,
        "item.component_added",
        "afterValues",
        occurredAt,
      );
      return items.listComponents(normalizeItemId(id));
    });
    return records.map(toItemDto);
  }

  async searchComponentCandidates(
    id: string,
    query: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto[]> {
    requirePermission(actor, "inventory.item.manage_components");
    const itemId = normalizeItemId(id);
    const normalizedQuery = query.trim();
    if ([...normalizedQuery].length > 100) {
      throw new ApplicationError("validation", "item_component_query_too_long");
    }
    const records = await this.unitOfWork.read(async ({ items }) => {
      if (!(await items.findItemById(itemId))) {
        throw new ApplicationError("not_found", "item_not_found");
      }
      return items.searchComponentCandidates(itemId, normalizedQuery, 50);
    });
    return records.map(toItemDto);
  }

  async removeComponent(
    id: string,
    componentId: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto[]> {
    requirePermission(actor, "inventory.item.manage_components");
    const [leftItemId, rightItemId] = canonicalComponentPair(id, componentId);
    const occurredAt = this.clock.now();
    const records = await this.unitOfWork.transaction(async ({ items }) => {
      const [leftItem, rightItem] = await Promise.all([
        items.findItemById(leftItemId),
        items.findItemById(rightItemId),
      ]);
      if (!leftItem || !rightItem) {
        throw new ApplicationError("not_found", "item_not_found");
      }
      const removed = await items.deleteComponent({
        leftItemId,
        rightItemId,
        actorId: actor.userId,
        occurredAt,
      });
      if (!removed) {
        throw new ApplicationError("not_found", "item_component_not_found");
      }
      await appendComponentAudits(
        items,
        this.ids,
        actor,
        leftItem,
        rightItem,
        "item.component_removed",
        "beforeValues",
        occurredAt,
      );
      return items.listComponents(normalizeItemId(id));
    });
    return records.map(toItemDto);
  }

  async listAudit(
    id: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemAuditDto[]> {
    requirePermission(actor, "inventory.item.manage_protected_fields");
    await this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(id);
      if (!item) throw new ApplicationError("not_found", "item_not_found");
    });
    const records = await this.unitOfWork.read(({ items }) => items.listAudit(id));
    return records.map(toAuditDto);
  }

  async listOperations(
    id: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemOperationDto[]> {
    const normalizedId = normalizeItemId(id);
    const records = await this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(normalizedId);
      if (!item) throw new ApplicationError("not_found", "item_not_found");
      assertItemReadable(item, actor);
      return items.listOperations(normalizedId);
    });
    return records.map((record) =>
      toOperationDto(
        record,
        hasPermission(actor.role, "inventory.item.read_all"),
        actor.role === "admin",
        hasPermission(actor.role, "inventory.item.comment"),
      ),
    );
  }

  async listComments(
    id: string,
    actor: AuthorizationActor,
  ): Promise<InventoryItemCommentDto[]> {
    if (!hasPermission(actor.role, "inventory.item.comment.read")) throw forbidden();
    const normalizedId = normalizeItemId(id);
    const records = await this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(normalizedId);
      if (!item) throw new ApplicationError("not_found", "item_not_found");
      assertItemReadable(item, actor);
      return items.listComments(normalizedId);
    });
    return records.map((record) => toCommentDto(normalizedId, record));
  }

  async addComment(
    id: string,
    message: unknown,
    actor: AuthorizationActor,
    attachment?: InventoryItemCommentAttachmentInput,
  ): Promise<InventoryItemCommentDto[]> {
    if (!hasPermission(actor.role, "inventory.item.comment")) throw forbidden();
    const normalizedId = normalizeItemId(id);
    const normalizedMessage = normalizeText(message, 2_000, "invalid_comment");
    const normalizedAttachment = attachment
      ? normalizeCommentAttachment(attachment)
      : null;
    const occurredAt = this.clock.now();
    const commentId = this.ids.create();
    const records = await this.unitOfWork.transaction(async ({ items }) => {
      const item = await items.findItemById(normalizedId);
      if (!item) throw new ApplicationError("not_found", "item_not_found");
      assertItemReadable(item, actor);
      await items.appendAudit(
        createAudit({
          id: commentId,
          actor,
          subjectId: normalizedId,
          subjectRevision: item.version,
          action: "item.comment_added",
          afterValues: { message: normalizedMessage },
          occurredAt,
        }),
      );
      if (normalizedAttachment) {
        await items.insertCommentAttachment({
          id: this.ids.create(),
          commentId,
          ...normalizedAttachment,
          createdAt: occurredAt,
        });
      }
      return items.listComments(normalizedId);
    });
    return records.map((record) => toCommentDto(normalizedId, record));
  }

  async findCommentAttachment(
    itemId: string,
    commentId: string,
    attachmentId: string,
    actor: AuthorizationActor,
  ): Promise<StoredInventoryItemCommentAttachment> {
    if (!hasPermission(actor.role, "inventory.item.comment.read")) throw forbidden();
    const normalizedItemId = normalizeItemId(itemId);
    const normalizedCommentId = normalizeId(commentId, "invalid_comment_id");
    const normalizedAttachmentId = normalizeId(attachmentId, "invalid_attachment_id");
    return this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(normalizedItemId);
      if (!item) throw new ApplicationError("not_found", "item_not_found");
      assertItemReadable(item, actor);
      const attachment = await items.findCommentAttachment(
        normalizedItemId,
        normalizedCommentId,
        normalizedAttachmentId,
      );
      if (!attachment) throw new ApplicationError("not_found", "attachment_not_found");
      return attachment;
    });
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
        inventoryNumberKey: inventoryNumberComparisonKey(inventoryNumber),
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

  async importItems(
    input: CreateInventoryItemInput[],
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto[]> {
    requirePermission(actor, "inventory.item.bulk_manage");
    if (!Array.isArray(input) || input.length < 1 || input.length > 2_000) {
      throw new ApplicationError("validation", "invalid_import_size");
    }
    const rows = input.map(normalizeCreateInput);
    const occurredAt = this.clock.now();
    const temporaryBase = this.temporaryNumbers.next(occurredAt.getUTCFullYear());

    return this.unitOfWork.transaction(async ({ items }) => {
      const createdItems: InventoryItemDto[] = [];
      for (const [index, values] of rows.entries()) {
        if (!(await items.roomExists(values.roomId))) {
          throw new ApplicationError("not_found", "room_not_found");
        }
        const itemId = this.ids.create();
        const qrId = this.ids.create();
        const inventoryNumber = values.inventoryNumber ??
          `${temporaryBase}-${String(index + 1).padStart(4, "0")}`;
        const inventoryNumberKind = values.inventoryNumber ? "official" : "temporary";
        const qrCode = qrIdentifierFromEntropy(this.qrEntropy.create());
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
          inventoryNumberKey: inventoryNumberComparisonKey(inventoryNumber),
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
            id: this.ids.create(),
            actor,
            subjectId: itemId,
            subjectRevision: created.version,
            action: "item.imported",
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
        createdItems.push(toItemDto({ ...created, qrCode }));
      }
      return createdItems;
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

  async updatePhoto(
    id: string,
    input: UpdateInventoryItemPhotoInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.edit_content");
    const photo = await normalizeCameraPhoto(input);
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== input.version) throw versionConflict();
      const updated = await items.updateItemPhoto({
        id,
        photoId: this.ids.create(),
        bytes: photo.bytes,
        width: photo.width,
        height: photo.height,
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt,
      });
      if (!updated) throw versionConflict();
      await items.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectId: id,
          subjectRevision: updated.version,
          action: "item.photo_captured",
          afterValues: {
            mimeType: "image/jpeg",
            width: photo.width,
            height: photo.height,
            byteSize: photo.bytes.byteLength,
          },
          occurredAt,
        }),
      );
      return toItemDto({ ...updated, qrCode: current.qrCode });
    });
  }

  async getItemPhoto(
    id: string,
    actor: AuthorizationActor,
  ): Promise<StoredItemPhoto> {
    return this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(id);
      const hasParentAccess = Boolean(
        item &&
          (hasPermission(actor.role, "inventory.item.read_all") ||
            (hasPermission(actor.role, "inventory.item.read_assigned") &&
              item.responsibleId === actor.userId)),
      );
      if (
        !item ||
        !canPerformInventoryOperation(actor, {
          operation: "photo.item.preview",
          currentResponsibleId: item.responsibleId,
          technicianHasParentAccess: hasParentAccess,
          viaAuthorizedActiveItemScan: false,
          hasParentAccess,
        })
      ) {
        throw new ApplicationError("not_found", "item_photo_not_found");
      }
      const photo = await items.findItemPhoto(id);
      if (!photo) {
        throw new ApplicationError("not_found", "item_photo_not_found");
      }
      return photo;
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
      const inventoryNumberKind =
        values.inventoryNumber === current.inventoryNumber
          ? current.inventoryNumberKind
          : "official";
      const updated = await items.updateItemProtected({
        id,
        ...values,
        inventoryNumberKind,
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
            roomLabel: itemLocationLabel(current),
            inventoryNumber: current.inventoryNumber,
            status: current.status,
            qrCode: current.qrCode,
          },
          afterValues: {
            roomId: updated.roomId,
            roomLabel: itemLocationLabel(updated),
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

  async resolveMaintenanceItem(
    id: string,
    input: ResolveMaintenanceItemInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.resolve_maintenance");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== input.version) throw versionConflict();
      if (current.status !== "maintenance") {
        throw new ApplicationError("conflict", "item_not_in_maintenance");
      }
      const updated = await items.resolveMaintenanceItem({
        id,
        status: input.status,
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt,
      });
      if (!updated) throw versionConflict();
      await items.appendAudit(
        createAudit({
          id: this.ids.create(),
          actor,
          subjectId: id,
          subjectRevision: updated.version,
          action: "item.maintenance_resolved",
          beforeValues: { status: current.status },
          afterValues: { status: updated.status },
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
    inventoryNumber: normalizeText(
      input.inventoryNumber,
      64,
      "invalid_inventory_number",
    ),
    inventoryNumberKey: inventoryNumberComparisonKey(input.inventoryNumber),
    status: normalizeStatus(input.status),
  };
}

function normalizeServiceInput(input: SendItemToServiceInput) {
  return {
    serviceName: normalizeText(input.serviceName, 160, "invalid_service_name"),
    reason: normalizeText(input.reason, 1_000, "invalid_service_reason"),
  };
}

async function normalizeCameraPhoto(input: UpdateInventoryItemPhotoInput) {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new ApplicationError("validation", "invalid_version");
  }
  if (typeof input.imageDataUrl !== "string") {
    throw new ApplicationError("validation", "invalid_camera_photo");
  }
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    input.imageDataUrl,
  );
  if (!match?.[1]) throw new ApplicationError("validation", "invalid_camera_photo");
  let decoded: string;
  try {
    decoded = atob(match[1]);
  } catch {
    throw new ApplicationError("validation", "invalid_camera_photo");
  }
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  if (bytes.byteLength < 1 || bytes.byteLength > 5 * 1024 * 1024) {
    throw new ApplicationError("validation", "invalid_camera_photo_size");
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new ApplicationError("validation", "invalid_camera_photo");
  }

  try {
    const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const image = sharp(source, {
      failOn: "warning",
      limitInputPixels: 2_500_000,
      limitInputChannels: 4,
      sequentialRead: true,
      unlimited: false,
    });
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg") {
      throw new ApplicationError("validation", "invalid_camera_photo");
    }
    const processed = await image
      .autoOrient()
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    const { width, height } = processed.info;
    if (
      width < 1 ||
      height < 1 ||
      width > 1920 ||
      height > 1920 ||
      width * height > 2_500_000
    ) {
      throw new ApplicationError("validation", "invalid_photo_dimensions");
    }
    if (processed.data.byteLength > 5 * 1024 * 1024) {
      throw new ApplicationError("validation", "invalid_camera_photo_size");
    }
    return {
      bytes: new Uint8Array(
        processed.data.buffer,
        processed.data.byteOffset,
        processed.data.byteLength,
      ),
      width,
      height,
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("validation", "invalid_camera_photo", {
      cause: error,
    });
  }
}

function normalizeText(value: unknown, max: number, code: string) {
  if (typeof value !== "string") throw new ApplicationError("validation", code);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || [...normalized].length > max) {
    throw new ApplicationError("validation", code);
  }
  return normalized;
}

const COMMENT_ATTACHMENT_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

function normalizeCommentAttachment(input: InventoryItemCommentAttachmentInput) {
  const rawName = normalizeText(input.fileName, 255, "invalid_comment_attachment");
  const fileName = rawName
    .replace(/.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const mediaType = normalizeText(input.mediaType, 127, "invalid_comment_attachment")
    .toLocaleLowerCase("en-US");
  if (
    !fileName ||
    [...fileName].length > 180 ||
    !COMMENT_ATTACHMENT_MEDIA_TYPES.has(mediaType) ||
    !(input.binaryData instanceof Uint8Array) ||
    input.binaryData.byteLength < 1 ||
    input.binaryData.byteLength > 2 * 1024 * 1024
  ) {
    throw new ApplicationError("validation", "invalid_comment_attachment");
  }
  return {
    fileName,
    mediaType,
    sizeBytes: input.binaryData.byteLength,
    binaryData: input.binaryData,
  };
}

function normalizeId(value: unknown, code: string) {
  const normalized = normalizeText(value, 64, code);
  if (!isUuid(normalized)) {
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

function requirePermission(
  actor: AuthorizationActor,
  permission:
    | "inventory.item.create"
    | "inventory.item.edit_content"
    | "inventory.item.send_to_service"
    | "inventory.item.resolve_maintenance"
    | "inventory.item.manage_protected_fields"
    | "inventory.item.manage_components"
    | "inventory.item.bulk_manage",
) {
  if (!hasPermission(actor.role, permission)) throw forbidden();
}

function normalizeItemId(id: string): string {
  const normalized = id.toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    throw new ApplicationError("validation", "invalid_id");
  }
  return normalized;
}

function canonicalComponentPair(id: string, componentId: string): [string, string] {
  const itemId = normalizeItemId(id);
  const normalizedComponentId = normalizeItemId(componentId);
  if (itemId === normalizedComponentId) {
    throw new ApplicationError("validation", "item_cannot_contain_itself");
  }
  return itemId < normalizedComponentId
    ? [itemId, normalizedComponentId]
    : [normalizedComponentId, itemId];
}

function assertItemReadable(
  item: InventoryItemRecord,
  actor: AuthorizationActor,
): void {
  if (
    !hasPermission(actor.role, "inventory.item.read_all") &&
    !(
      hasPermission(actor.role, "inventory.item.read_assigned") &&
      item.responsibleId === actor.userId
    )
  ) {
    throw forbidden();
  }
}

async function appendComponentAudits(
  items: InventoryItemRepositories["items"],
  ids: InventoryItemIds,
  actor: AuthorizationActor,
  leftItem: InventoryItemRecord,
  rightItem: InventoryItemRecord,
  action: "item.component_added" | "item.component_removed",
  snapshotKind: "beforeValues" | "afterValues",
  occurredAt: Date,
): Promise<void> {
  const counterpartValues = (counterpart: InventoryItemRecord) => ({
    componentId: counterpart.id,
    componentName: counterpart.name,
    componentInventoryNumber: counterpart.inventoryNumber,
  });
  await Promise.all([
    items.appendAudit(
      createAudit({
        id: ids.create(),
        actor,
        subjectId: leftItem.id,
        subjectRevision: leftItem.version,
        action,
        [snapshotKind]: counterpartValues(rightItem),
        occurredAt,
      }),
    ),
    items.appendAudit(
      createAudit({
        id: ids.create(),
        actor,
        subjectId: rightItem.id,
        subjectRevision: rightItem.version,
        action,
        [snapshotKind]: counterpartValues(leftItem),
        occurredAt,
      }),
    ),
  ]);
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
    maintenanceStartedAt: record.maintenanceStartedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
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

function itemLocationLabel(
  record: Pick<InventoryItemRecord, "buildingName" | "roomDesignation">,
) {
  return `${record.buildingName}, ${record.roomDesignation}`;
}

function toAuditDto(record: InventoryItemAuditRecord): InventoryItemAuditDto {
  return {
    id: record.id,
    actorId: record.actorId,
    actorName: record.actorName,
    actorEmail: record.actorEmail,
    actorRole: record.actorRole,
    subjectRevision: record.subjectRevision,
    action: record.action,
    beforeValues: record.beforeValues,
    afterValues: record.afterValues,
    occurredAt: record.occurredAt.toISOString(),
  };
}

function toCommentDto(
  itemId: string,
  record: InventoryItemCommentRecord,
): InventoryItemCommentDto {
  return {
    id: record.id,
    authorName: record.authorName,
    authorEmail: record.authorEmail,
    message: record.message,
    createdAt: record.createdAt.toISOString(),
    attachment: record.attachment
      ? {
          ...record.attachment,
          downloadUrl: `/api/inventory/items/${itemId}/comments/${record.id}/attachments/${record.attachment.id}`,
        }
      : null,
  };
}

function toOperationDto(
  record: InventoryItemOperationRecord,
  canReadAll: boolean,
  canReadAdministrative: boolean,
  canReadComments: boolean,
): InventoryItemOperationDto {
  const componentValues = record.action === "item.component_added"
    ? record.afterValues
    : record.action === "item.component_removed"
      ? record.beforeValues
      : null;
  const componentName = componentValues?.componentName;
  const componentInventoryNumber = canReadAdministrative
    ? componentValues?.componentInventoryNumber
    : undefined;
  const rawValues = record.afterValues ?? record.beforeValues;
  const safeValues = record.kind === "item" && !canReadAdministrative
    ? {
        ...(typeof rawValues?.name === "string" ? { name: rawValues.name } : {}),
        ...(typeof rawValues?.status === "string" ? { status: rawValues.status } : {}),
      }
    : rawValues;
  const source = safeValues?.source;
  const status = safeValues?.status;
  const outcome = safeValues?.outcome;
  const beforeRoomId = record.kind === "item" && canReadAll
    ? record.beforeValues?.roomId
    : undefined;
  const afterRoomId = record.kind === "item" && canReadAll
    ? record.afterValues?.roomId
    : undefined;
  const roomChanged =
    typeof beforeRoomId === "string" &&
    typeof afterRoomId === "string" &&
    beforeRoomId !== afterRoomId;
  const itemName = record.kind === "item"
    ? safeValues?.name
    : undefined;
  const serviceName = record.kind === "item" && canReadAdministrative
    ? safeValues?.serviceName
    : undefined;
  const reason = record.kind === "item" && canReadAdministrative
    ? safeValues?.reason
    : undefined;
  const comment = canReadComments
    ? safeValues?.decisionComment ??
      (canReadAdministrative ? safeValues?.administrativeReason : undefined) ??
      safeValues?.detail
    : undefined;
  const targetName = record.kind === "item" ? undefined : record.targetName;
  return {
    id: record.id,
    kind: record.kind,
    action: record.action,
    actorName: record.actorName,
    actorEmail: canReadComments ? record.actorEmail : null,
    occurredAt: record.occurredAt.toISOString(),
    detail:
      typeof componentName === "string" ||
      typeof componentInventoryNumber === "string" ||
      typeof targetName === "string" ||
      typeof itemName === "string" ||
      typeof serviceName === "string" ||
      typeof reason === "string" ||
      typeof source === "string" ||
      typeof status === "string" ||
      typeof outcome === "string" ||
      roomChanged ||
      typeof record.fromLocation === "string" ||
      typeof record.toLocation === "string" ||
      typeof comment === "string"
        ? {
            ...(typeof componentName === "string" ? { componentName } : {}),
            ...(typeof componentInventoryNumber === "string"
              ? { componentInventoryNumber }
              : {}),
            ...(typeof targetName === "string" ? { targetName } : {}),
            ...(typeof itemName === "string" ? { itemName } : {}),
            ...(typeof serviceName === "string" ? { serviceName } : {}),
            ...(typeof reason === "string" ? { reason } : {}),
            ...(typeof source === "string" ? { source } : {}),
            ...(typeof status === "string" ? { status } : {}),
            ...(typeof outcome === "string" ? { outcome } : {}),
            ...(roomChanged
              ? { fromRoomId: beforeRoomId, toRoomId: afterRoomId }
              : {}),
            ...(typeof record.fromLocation === "string"
              ? { fromLocation: record.fromLocation }
              : {}),
            ...(typeof record.toLocation === "string"
              ? { toLocation: record.toLocation }
              : {}),
            ...(typeof comment === "string" ? { comment } : {}),
          }
        : null,
  };
}
