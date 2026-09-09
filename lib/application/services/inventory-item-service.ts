import type {
  CreateInventoryItemInput,
  InventoryItemAuditDto,
  InventoryItemDto,
  InventoryItemOperationDto,
  MarkDecommissionedItemInUseInput,
  RestoreDecommissionedItemInput,
  UpdateInventoryItemContentInput,
  UpdateInventoryItemPhotoInput,
  UpdateInventoryItemProtectedInput,
} from "@/lib/contracts/inventory-items";
import type {
  BulkChangeTmcLocationInput,
  TmcBulkOperationResultDto,
  TmcOperationItemOutcomeDto,
} from "@/lib/contracts/tmc-operations";
import type {
  AppendItemAuditRecord,
  InventoryItemAuditRecord,
  InventoryItemOperationRecord,
  InventoryItemRecord,
  InventoryItemRepositories,
  StoredItemPhoto,
} from "@/lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type { InventoryResponsibilityRepository } from "@/lib/application/ports/inventory-responsibility-repositories";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import { qrIdentifierFromEntropy } from "@/lib/domain/qr-identifier";
import {
  inventoryNumberComparisonKey,
  parseCode39ScanInput,
} from "@/lib/domain/code39";
import {
  canPerformInventoryOperation,
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";
import type { ItemStatus } from "@/lib/contracts/inventory-domain";
import {
  categoryFromLegacyType,
  isInventoryItemCategory,
  type InventoryItemCategory,
} from "@/lib/inventory-categories";
import sharp from "sharp";
import {
  InventoryItemCommentService,
  type InventoryItemCommentAttachmentInput,
} from "@/lib/application/services/inventory-item-comment-service";

export type { InventoryItemCommentAttachmentInput } from "@/lib/application/services/inventory-item-comment-service";

const ITEM_FORM_RESPONSIBILITY_REASON = "inventory_item_form_assignment";

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
  photo?: {
    imageDataUrl: string;
    width: number;
    height: number;
  };
}

export interface ResolveMaintenanceItemInput {
  version: number;
  status: "active" | "decommissioned";
}

export class InventoryItemService {
  private readonly comments: InventoryItemCommentService;

  constructor(
    private readonly unitOfWork: UnitOfWork<InventoryItemRepositories>,
    private readonly clock: InventoryItemClock,
    private readonly ids: InventoryItemIds,
    private readonly qrEntropy: InventoryItemQrEntropy,
    private readonly temporaryNumbers: TemporaryNumberSource,
  ) {
    this.comments = new InventoryItemCommentService(unitOfWork, clock, ids);
  }

  async listItems(actor: AuthorizationActor): Promise<InventoryItemDto[]> {
    const repositories = await this.unitOfWork.transaction(async (repos) => {
      if (hasPermission(actor.role, "inventory.item.read_all")) {
        return repos.items.listItems();
      }
      if (hasPermission(actor.role, "inventory.item.read_assigned")) {
        return repos.items.listItemsAssignedTo(actor.userId);
      }
      throw forbidden();
    }, { isolation: "repeatable-read", readOnly: true });
    // The repository query is already scoped to the employee's current
    // responsibility. Keep every lifecycle state in that scoped result so
    // the employee tabs and summary cards can show their own decommissioned
    // items as well.
    return repositories.map(toItemDto);
  }

  async listDecommissionedItems(
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto[]> {
    const records = await this.unitOfWork.transaction(async (repos) => {
      if (hasPermission(actor.role, "inventory.item.read_all")) {
        return repos.items.listDecommissionedItems();
      }
      if (hasPermission(actor.role, "inventory.item.read_assigned")) {
        return repos.items.listDecommissionedItemsAssignedTo(actor.userId);
      }
      throw forbidden();
    }, { isolation: "repeatable-read", readOnly: true });
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
          (value.responsibleId === actor.userId ||
            value.roomResponsibleId === actor.userId)
        )
      ) {
        // Do not reveal whether an item ID exists to a caller outside its
        // visibility scope. Item detail reads use the same public result for
        // missing and inaccessible resources.
        throw itemNotFound();
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
      // A linked component is part of the assigned item's composition. Hiding
      // it when another employee is responsible for that component makes the
      // composition look incomplete and prevents the card from being useful.
      return items.listComponents(normalizedId);
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
        leftItem.status === "decommissioned_in_use" ||
        rightItem.status === "decommissioned" ||
        rightItem.status === "decommissioned_in_use"
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
  ) {
    return this.comments.listComments(id, actor);
  }

  async addComment(
    id: string,
    message: unknown,
    actor: AuthorizationActor,
    attachment?: InventoryItemCommentAttachmentInput,
  ) {
    return this.comments.addComment(id, message, actor, attachment);
  }

  async findCommentAttachment(
    itemId: string,
    commentId: string,
    attachmentId: string,
    actor: AuthorizationActor,
  ) {
    return this.comments.findCommentAttachment(
      itemId,
      commentId,
      attachmentId,
      actor,
    );
  }

  async createItem(
    input: CreateInventoryItemInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.create");
    const authorizedInput = actor.role === "warehouse"
      ? normalizeWarehouseCreateInput(input)
      : input;
    const values = normalizeCreateInput(authorizedInput);
    if (values.responsibleUserId) {
      requirePermission(actor, "inventory.item.manage_protected_fields");
    }
    const requestedPhotos = authorizedInput.photos ?? (authorizedInput.photo ? [authorizedInput.photo] : []);
    if (requestedPhotos.length > 4) {
      throw new ApplicationError("validation", "photo_limit_reached");
    }
    const photos = await Promise.all(
      requestedPhotos.map((photo) => normalizeCameraPhoto({ version: 1, ...photo })),
    );
    const occurredAt = this.clock.now();
    const itemId = this.ids.create();
    const qrId = this.ids.create();
    const auditId = this.ids.create();
    const inventoryNumber = values.inventoryNumber
      ? values.inventoryNumber
      : this.temporaryNumbers.next(occurredAt.getUTCFullYear());
    const inventoryNumberKind = values.inventoryNumber ? "official" : "temporary";
    const qrCode = qrIdentifierFromEntropy(this.qrEntropy.create());

    return this.unitOfWork.transaction(async ({ items, responsibility }) => {
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
      await this.changeResponsible({
        repository: responsibility,
        itemId,
        responsibleUserId: values.responsibleUserId,
        actor,
        subjectRevision: created.version,
        occurredAt,
      });
      const assigned = values.responsibleUserId !== undefined
        ? await items.findItemById(itemId)
        : created;
      if (!assigned) throw new Error("item_refresh_failed");
      let photographed = assigned;
      for (const [index, photo] of photos.entries()) {
        const updated = await items.updateItemPhoto({
          id: itemId,
          photoId: this.ids.create(),
          bytes: photo.bytes,
          width: photo.width,
          height: photo.height,
          actorId: actor.userId,
          expectedVersion: photographed.version,
          occurredAt,
        });
        if (!updated) throw versionConflict();
        photographed = updated;
        await items.appendAudit(
          createAudit({
            id: this.ids.create(), actor, subjectId: itemId,
            subjectRevision: photographed.version,
            action: "item.photo_captured",
            beforeValues: { photoCount: index },
            afterValues: { photoCount: index + 1, width: photo.width, height: photo.height, byteSize: photo.bytes.byteLength },
            occurredAt,
          }),
        );
      }
      return toItemDto({ ...photographed, qrCode });
    });
  }

  private async changeResponsible(input: {
    repository: InventoryResponsibilityRepository | undefined;
    itemId: string;
    responsibleUserId: string | null | undefined;
    actor: AuthorizationActor;
    subjectRevision: number;
    occurredAt: Date;
  }): Promise<void> {
    if (input.responsibleUserId === undefined) return;
    const repository = input.repository;
    if (!repository) throw new Error("responsibility_repository_unavailable");
    const current = await repository.findItemStateForUpdate(input.itemId);
    if (!current) throw new ApplicationError("not_found", "item_not_found");
    if (current.responsibleUserId === input.responsibleUserId) return;
    if (await repository.findPendingTransfer(input.itemId)) {
      throw new ApplicationError("conflict", "transfer_already_pending");
    }
    if (input.responsibleUserId) {
      if (current.itemStatus === "decommissioned") {
        throw new ApplicationError("conflict", "item_not_available");
      }
      const target = await repository.findAuthorizationUserForUpdate(
        input.responsibleUserId,
      );
      if (
        !target ||
        target.id !== input.responsibleUserId ||
        !target.active ||
        target.deletedAt ||
        target.role !== "employee"
      ) {
        throw new ApplicationError(
          "validation",
          "responsible_user_not_available",
        );
      }
    }
    if (current.responsibleUserId && current.responsibilityPeriodId) {
      const closed = await repository.closeResponsibility({
        itemId: input.itemId,
        expectedResponsibilityPeriodId: current.responsibilityPeriodId,
        expectedResponsibleUserId: current.responsibleUserId,
        endedBy: input.actor.userId,
        endedAt: input.occurredAt,
        endReason: ITEM_FORM_RESPONSIBILITY_REASON,
      });
      if (!closed) throw versionConflict();
    }
    if (input.responsibleUserId) {
      try {
        await repository.insertResponsibility({
          id: this.ids.create(),
          itemId: input.itemId,
          responsibleUserId: input.responsibleUserId,
          source: "admin_override",
          startedBy: input.actor.userId,
          startedAt: input.occurredAt,
        });
      } catch (error) {
        if (postgresErrorCode(error) === "23505") throw versionConflict();
        throw error;
      }
    }
    await repository.appendAudit({
      id: this.ids.create(),
      actorId: input.actor.userId,
      actorRole: input.actor.role,
      subjectKind: "responsibility",
      subjectId: input.itemId,
      subjectRevision: input.subjectRevision,
      action: "responsibility.admin_override",
      beforeValues: {
        responsibleUserId: current.responsibleUserId,
      },
      afterValues: {
        responsibleUserId: input.responsibleUserId,
        source: "admin_override",
        ...(input.responsibleUserId ? {} : { outcome: "released" }),
      },
      reason: ITEM_FORM_RESPONSIBILITY_REASON,
      isAdministrativeException: true,
      occurredAt: input.occurredAt,
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

  async bulkChangeLocation(
    input: BulkChangeTmcLocationInput,
    actor: AuthorizationActor,
  ): Promise<TmcBulkOperationResultDto> {
    requirePermission(actor, "inventory.item.bulk_manage");
    const normalized = normalizeBulkLocationInput(input);
    const occurredAt = this.clock.now();

    return this.unitOfWork.transaction(async ({ items }) => {
      if (!(await items.roomExists(normalized.roomId))) {
        throw new ApplicationError("not_found", "room_not_found");
      }

      const outcomes: TmcOperationItemOutcomeDto[] = [];
      for (const reference of normalized.items) {
        const current = await items.findItemById(reference.itemId);
        if (!current) {
          outcomes.push(problemOutcome(reference.itemId, "item_not_found"));
          continue;
        }
        if (current.status !== "active" || current.archivedAt) {
          outcomes.push(problemOutcome(reference.itemId, "item_inactive"));
          continue;
        }
        if (current.version !== reference.itemVersion) {
          outcomes.push(problemOutcome(reference.itemId, "version_conflict"));
          continue;
        }
        const updated = await items.updateItemLocation({
          id: reference.itemId,
          roomId: normalized.roomId,
          actorId: actor.userId,
          expectedVersion: reference.itemVersion,
          occurredAt,
        });
        if (!updated) {
          outcomes.push(problemOutcome(reference.itemId, "version_conflict"));
          continue;
        }
        await items.appendAudit(createAudit({
          id: this.ids.create(),
          actor,
          subjectId: reference.itemId,
          subjectRevision: updated.version,
          action: "item.location_changed",
          beforeValues: {
            roomId: current.roomId,
            location: `${current.buildingName} / ${current.roomDesignation}`,
          },
          afterValues: {
            roomId: updated.roomId,
            location: `${updated.buildingName} / ${updated.roomDesignation}`,
            ...(normalized.comment ? { comment: normalized.comment } : {}),
          },
          occurredAt,
        }));
        outcomes.push({
          itemId: reference.itemId,
          outcome: "success",
          itemVersion: updated.version,
        });
      }

      const succeeded = outcomes.filter((item) => item.outcome === "success").length;
      return {
        total: outcomes.length,
        succeeded,
        problems: outcomes.length - succeeded,
        items: outcomes,
      };
    }, { isolation: "serializable", maxAttempts: 3 });
  }

  async bulkChangeCategory(
    itemIds: readonly string[],
    category: unknown,
    actor: AuthorizationActor,
  ): Promise<string[]> {
    requirePermission(actor, "inventory.item.bulk_manage");
    const ids = normalizeBulkItemIds(itemIds);
    const normalizedCategory = normalizeCategory(category);
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ items }) => {
      const updatedIds: string[] = [];
      for (const id of ids) {
        const current = await items.findItemById(id);
        if (!current) continue;
        const updated = await items.updateItemCategory({
          id,
          category: normalizedCategory,
          actorId: actor.userId,
          occurredAt,
        });
        if (!updated) continue;
        await items.appendAudit(
          createAudit({
            id: this.ids.create(),
            actor,
            subjectId: id,
            subjectRevision: updated.version,
            action: "item.category_updated",
            beforeValues: { category: current.itemType },
            afterValues: { category: updated.itemType },
            occurredAt,
          }),
        );
        updatedIds.push(id);
      }
      return updatedIds;
    }, { isolation: "serializable", maxAttempts: 3 });
  }

  async deleteItems(
    itemIds: readonly string[],
    actor: AuthorizationActor,
  ): Promise<string[]> {
    requirePermission(actor, "inventory.item.delete");
    const ids = normalizeBulkItemIds(itemIds);
    return this.unitOfWork.transaction(
      ({ items }) => items.deleteItems(ids),
      { isolation: "serializable", maxAttempts: 3 },
    );
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
        itemType: patch.category ?? current.itemType,
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
      if ((current.photoIds?.length ?? (current.photoUrl ? 1 : 0)) >= 4) {
        throw new ApplicationError("conflict", "photo_limit_reached");
      }
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

  async removePhoto(
    id: string,
    version: number,
    actor: AuthorizationActor,
    photoId?: string,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.edit_content");
    if (!Number.isInteger(version) || version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== version) throw versionConflict();
      if (!current.photoUrl) {
        throw new ApplicationError("not_found", "item_photo_not_found");
      }
      const updated = await items.removeItemPhoto({
        id,
        photoId,
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
          action: "item.photo_removed",
          beforeValues: { photoCount: current.photoIds?.length ?? 1 },
          afterValues: { photoCount: Math.max(0, (current.photoIds?.length ?? 1) - (photoId ? 1 : (current.photoIds?.length ?? 1))) },
          occurredAt,
        }),
      );
      return toItemDto(updated);
    });
  }

  async getItemPhoto(
    id: string,
    actor: AuthorizationActor,
    photoId?: string,
  ): Promise<StoredItemPhoto> {
    return this.getItemPhotoByPurpose(id, actor, "item", photoId);
  }

  async getServiceItemPhoto(
    id: string,
    actor: AuthorizationActor,
  ): Promise<StoredItemPhoto> {
    return this.getItemPhotoByPurpose(id, actor, "service_request");
  }

  async getDecommissionedUsagePhoto(
    id: string,
    actor: AuthorizationActor,
  ): Promise<StoredItemPhoto> {
    return this.getItemPhotoByPurpose(id, actor, "decommissioned_usage");
  }

  private async getItemPhotoByPurpose(
    id: string,
    actor: AuthorizationActor,
    purpose: "item" | "service_request" | "decommissioned_usage",
    photoId?: string,
  ): Promise<StoredItemPhoto> {
    return this.unitOfWork.read(async ({ items }) => {
      const item = await items.findItemById(id);
      const hasParentAccess = Boolean(
        item &&
          (hasPermission(actor.role, "inventory.item.read_all") ||
            (hasPermission(actor.role, "inventory.item.read_assigned") &&
              (item.responsibleId === actor.userId ||
                item.roomResponsibleId === actor.userId))),
      );
      if (
        !item ||
        !canPerformInventoryOperation(actor, {
          operation: "photo.item.preview",
          currentResponsibleId:
            item.roomResponsibleId === actor.userId
              ? item.roomResponsibleId
              : item.responsibleId,
          technicianHasParentAccess: hasParentAccess,
          viaAuthorizedActiveItemScan: false,
          hasParentAccess,
        })
      ) {
        throw new ApplicationError("not_found", "item_photo_not_found");
      }
      const photo = purpose === "item"
        ? await items.findItemPhoto(id, photoId)
        : purpose === "service_request"
          ? await items.findServiceItemPhoto(id)
          : items.findDecommissionedUsagePhoto
            ? await items.findDecommissionedUsagePhoto(id)
            : null;
      if (!photo) {
        throw new ApplicationError("not_found", "item_photo_not_found");
      }
      return photo;
    });
  }

  async markDecommissionedInUse(
    id: string,
    input: MarkDecommissionedItemInUseInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.manage_protected_fields");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const roomId = normalizeId(input.roomId, "invalid_room_id");
    const responsibleUserId = normalizeOptionalResponsibleUserId(
      input.responsibleUserId,
    );
    const reason = normalizeOptionalBlankText(
      input.reason,
      1_000,
      "invalid_decommissioned_usage_reason",
    ) ?? null;
    const adminComment = normalizeOptionalBlankText(
      input.adminComment,
      2_000,
      "invalid_decommissioned_usage_comment",
    ) ?? null;
    const photo = input.photo
      ? await normalizeCameraPhoto({ version: input.version, ...input.photo })
      : null;
    return this.unitOfWork.transaction(async ({ items, responsibility }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== input.version) throw versionConflict();
      if (current.status === "decommissioned_in_use") {
        throw new ApplicationError("conflict", "decommissioned_usage_invalid_state");
      }
      if (!(await items.roomExists(roomId))) {
        throw new ApplicationError("not_found", "room_not_found");
      }
      const occurredAt = this.clock.now();
      if (!items.markDecommissionedInUse) throw new Error("decommissioned_workflow_unavailable");
      const updated = await items.markDecommissionedInUse({
        id,
        roomId,
        reason,
        adminComment,
        photoId: photo ? this.ids.create() : null,
        photoBytes: photo?.bytes ?? null,
        photoWidth: photo?.width ?? null,
        photoHeight: photo?.height ?? null,
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt,
      });
      if (!updated) throw versionConflict();
      await this.changeResponsible({
        repository: responsibility,
        itemId: id,
        responsibleUserId,
        actor,
        subjectRevision: updated.version,
        occurredAt,
      });
      await items.appendAudit(createAudit({
        id: this.ids.create(), actor, subjectId: id,
        subjectRevision: updated.version,
        action: "item.decommissioned_usage_started",
        beforeValues: { status: current.status, roomId: current.roomId },
        afterValues: {
          status: "decommissioned_in_use",
          roomId,
          responsibleUserId,
          reason,
          adminComment,
          photo: photo ? "attached" : null,
        },
        occurredAt,
      }));
      const refreshed = await items.findItemById(id);
      if (!refreshed) throw new Error("item_refresh_failed");
      return toItemDto(refreshed);
    });
  }

  async restoreDecommissionedItem(
    id: string,
    input: RestoreDecommissionedItemInput,
    actor: AuthorizationActor,
  ): Promise<InventoryItemDto> {
    requirePermission(actor, "inventory.item.manage_protected_fields");
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    const reason = normalizeText(input.reason, 1_000, "restore_reason_required");
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== input.version) throw versionConflict();
      if (current.status !== "decommissioned" && current.status !== "decommissioned_in_use") {
        throw new ApplicationError("conflict", "restore_invalid_state");
      }
      const occurredAt = this.clock.now();
      if (!items.restoreDecommissionedItem) throw new Error("decommissioned_workflow_unavailable");
      const updated = await items.restoreDecommissionedItem({
        id, actorId: actor.userId, expectedVersion: input.version, occurredAt,
      });
      if (!updated) throw versionConflict();
      await items.appendAudit(createAudit({
        id: this.ids.create(), actor, subjectId: id,
        subjectRevision: updated.version,
        action: "item.restored_from_decommission",
        beforeValues: { status: current.status },
        afterValues: { status: "active", reason },
        occurredAt,
      }));
      return toItemDto(updated);
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
    return this.unitOfWork.transaction(async ({ items, responsibility }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (current.version !== input.version) throw versionConflict();
      if (
        (current.status === "decommissioned_in_use" && values.status !== current.status) ||
        (values.status === "decommissioned_in_use" && current.status !== values.status) ||
        (current.status === "decommissioned" && values.status !== "decommissioned")
      ) {
        throw new ApplicationError("conflict", "decommissioned_workflow_required");
      }
      if (!(await items.roomExists(values.roomId))) {
        throw new ApplicationError("not_found", "room_not_found");
      }
      const inventoryNumberKind =
        values.inventoryNumber === current.inventoryNumber
          ? current.inventoryNumberKind
          : "official";
      const inventoryNumberChanged = values.inventoryNumber !== current.inventoryNumber;
      const occurredAt = this.clock.now();
      const updated = await items.updateItemProtected({
        id,
        ...values,
        condition: values.condition ?? current.condition ?? "good",
        connectionStatus:
          values.connectionStatus ?? current.connectionStatus ?? "not_applicable",
        inventoryNumberKind,
        ...(inventoryNumberChanged
          ? {
              inventoryNumberHistoryId: this.ids.create(),
              inventoryNumberChangeReason: "Исправление номера / штрих-кода ТМЦ",
            }
          : {}),
        actorId: actor.userId,
        expectedVersion: input.version,
        occurredAt,
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
      await this.changeResponsible({
        repository: responsibility,
        itemId: id,
        responsibleUserId: values.responsibleUserId,
        actor,
        subjectRevision: updated.version,
        occurredAt,
      });
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
            ...(current.condition ? { condition: current.condition } : {}),
            ...(current.connectionStatus
              ? { connectionStatus: current.connectionStatus }
              : {}),
            qrCode: current.qrCode,
          },
          afterValues: {
            roomId: updated.roomId,
            roomLabel: itemLocationLabel(updated),
            inventoryNumber: updated.inventoryNumber,
            ...(inventoryNumberChanged
              ? { inventoryNumberChangeReason: "Исправление номера / штрих-кода ТМЦ" }
              : {}),
            status: updated.status,
            ...(current.condition || updated.condition
              ? { condition: updated.condition }
              : {}),
            ...(current.connectionStatus || updated.connectionStatus
              ? { connectionStatus: updated.connectionStatus }
              : {}),
            qrCode,
            qrReplaceReason,
          },
          occurredAt,
        }),
      );
      const refreshed = values.responsibleUserId !== undefined
        ? await items.findItemById(id)
        : updated;
      if (!refreshed) throw new Error("item_refresh_failed");
      return toItemDto({ ...refreshed, qrCode });
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
    if (!input.photo) {
      throw new ApplicationError("validation", "service_photo_required");
    }
    const photo = await normalizeCameraPhoto({ version: 1, ...input.photo });
    const occurredAt = this.clock.now();
    return this.unitOfWork.transaction(async ({ items }) => {
      const current = await items.findItemById(id);
      if (!current) throw new ApplicationError("not_found", "item_not_found");
      if (actor.role === "employee" && current.responsibleId !== actor.userId) {
        throw forbidden();
      }
      if (current.version !== version) throw versionConflict();
      await items.insertServiceItemPhoto({
        id: this.ids.create(),
        itemId: id,
        bytes: photo.bytes,
        width: photo.width,
        height: photo.height,
        actorId: actor.userId,
        occurredAt,
      });
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
            servicePhotoAttached: true,
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
  const suppliedInventoryNumber =
    input.inventoryNumber === undefined || input.inventoryNumber === null
      ? null
      : normalizeText(input.inventoryNumber, 64, "invalid_inventory_number");
  const barcode =
    input.barcode === undefined || input.barcode === null
      ? null
      : normalizeText(input.barcode, 64, "invalid_barcode");
  if (barcode && suppliedInventoryNumber) {
    throw new ApplicationError("validation", "ambiguous_item_code");
  }
  const parsedBarcode = barcode ? parseCode39ScanInput(barcode) : null;
  if (parsedBarcode && !parsedBarcode.ok) {
    throw new ApplicationError("validation", "invalid_barcode");
  }
  if (parsedBarcode?.ok && !parsedBarcode.inventoryNumber) {
    throw new ApplicationError("validation", "barcode_belongs_to_existing_item");
  }
  const inventoryNumber = parsedBarcode?.ok
    ? parsedBarcode.inventoryNumber
    : suppliedInventoryNumber;
  return {
    ...content,
    itemType: content.category ?? categoryFromLegacyType(input.itemType ?? ""),
    brand: content.brand ?? null,
    model: content.model ?? null,
    quantity: content.quantity ?? 1,
    unitPrice: content.unitPrice ?? 0,
    roomId,
    inventoryNumber,
    responsibleUserId: normalizeOptionalResponsibleUserId(
      input.responsibleUserId,
    ),
  };
}

function normalizeWarehouseCreateInput(
  input: CreateInventoryItemInput,
): CreateInventoryItemInput {
  const hasProtectedValues =
    (input.brand !== undefined && input.brand !== null) ||
    (input.model !== undefined && input.model !== null) ||
    (input.quantity !== undefined && input.quantity !== null && input.quantity !== 1) ||
    (input.unitPrice !== undefined && input.unitPrice !== null && input.unitPrice !== 0) ||
    (input.barcode !== undefined && input.barcode !== null) ||
    (input.inventoryNumber !== undefined && input.inventoryNumber !== null) ||
    (input.responsibleUserId !== undefined && input.responsibleUserId !== null);
  if (hasProtectedValues) throw forbidden();
  return {
    name: input.name,
    category: input.category,
    description: input.description,
    roomId: input.roomId,
    photo: input.photo,
    photos: input.photos,
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 0,
    barcode: null,
    inventoryNumber: null,
  };
}

function normalizeContentInput(input: {
  version: unknown;
  name: unknown;
  category?: unknown;
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
    category: normalizeOptionalCategory(input.category),
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

function normalizeOptionalCategory(value: unknown): InventoryItemCategory | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeCategory(value);
}

function normalizeCategory(value: unknown): InventoryItemCategory {
  if (!isInventoryItemCategory(value)) {
    throw new ApplicationError("validation", "invalid_item_category");
  }
  return value;
}

function normalizeBulkItemIds(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2_000) {
    throw new ApplicationError("validation", "invalid_item_selection");
  }
  const ids = value.map((id) => normalizeItemId(id));
  if (new Set(ids).size !== ids.length) {
    throw new ApplicationError("validation", "duplicate_item");
  }
  return ids;
}

function normalizeBulkLocationInput(input: BulkChangeTmcLocationInput) {
  if (
    !input ||
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 50
  ) {
    throw new ApplicationError("validation", "invalid_bulk_operation_size");
  }
  const roomId = normalizeItemId(input.roomId);
  const itemReferences = input.items.map((reference) => {
    const itemId = normalizeItemId(reference.itemId);
    if (!Number.isInteger(reference.itemVersion) || reference.itemVersion < 1) {
      throw new ApplicationError("validation", "invalid_version");
    }
    return { itemId, itemVersion: reference.itemVersion };
  });
  if (new Set(itemReferences.map((item) => item.itemId)).size !== itemReferences.length) {
    throw new ApplicationError("validation", "duplicate_item");
  }
  let comment: string | null = null;
  if (input.comment !== undefined && input.comment !== null && input.comment !== "") {
    comment = normalizeText(input.comment, 1_000, "invalid_comment");
  }
  return { roomId, items: itemReferences, comment };
}

function problemOutcome(
  itemId: string,
  problem: "item_not_found" | "item_inactive" | "version_conflict",
): TmcOperationItemOutcomeDto {
  return { itemId, outcome: "problem", problem };
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
    condition: normalizeOptionalCondition(input.condition),
    connectionStatus: normalizeOptionalConnectionStatus(input.connectionStatus),
    responsibleUserId: normalizeOptionalResponsibleUserId(
      input.responsibleUserId,
    ),
  };
}

function normalizeOptionalBlankText(value: unknown, max: number, code: string) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return normalizeText(value, max, code);
}

function normalizeOptionalResponsibleUserId(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return normalizeId(value, "invalid_responsible_user_id").toLowerCase();
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function normalizeOptionalCondition(
  value: unknown,
): UpdateInventoryItemProtectedInput["condition"] {
  if (value === undefined) return undefined;
  if (value === "good" || value === "needs_attention" || value === "damaged") {
    return value;
  }
  throw new ApplicationError("validation", "invalid_item_condition");
}

function normalizeOptionalConnectionStatus(
  value: unknown,
): UpdateInventoryItemProtectedInput["connectionStatus"] {
  if (value === undefined) return undefined;
  if (
    value === "connected" ||
    value === "disconnected" ||
    value === "not_applicable"
  ) {
    return value;
  }
  throw new ApplicationError("validation", "invalid_connection_status");
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

function normalizeId(value: unknown, code: string) {
  const normalized = normalizeText(value, 64, code);
  if (!isUuid(normalized)) {
    throw new ApplicationError("validation", code);
  }
  return normalized;
}

function normalizeStatus(value: unknown): ItemStatus {
  if (
    value === "active" ||
    value === "maintenance" ||
    value === "decommissioned" ||
    value === "decommissioned_in_use"
  ) {
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
    | "inventory.item.bulk_manage"
    | "inventory.item.delete",
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
      (item.responsibleId === actor.userId ||
        item.roomResponsibleId === actor.userId)
    )
  ) {
    // Read-only item subresources (comments, components, operations and
    // attachments) must not turn an existing foreign item into an oracle.
    throw itemNotFound();
  }
}

function itemNotFound() {
  return new ApplicationError("not_found", "item_not_found");
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
    category: isInventoryItemCategory(record.itemType)
      ? record.itemType
      : categoryFromLegacyType(record.itemType),
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
    condition: record.condition ?? "good",
    connectionStatus: record.connectionStatus ?? "not_applicable",
    qrCode: record.qrCode,
    responsible: record.responsibleId
      ? { id: record.responsibleId, name: record.responsibleName ?? "" }
      : null,
    photoUrl: record.photoUrl,
    photoUrls: record.photoIds?.map(
      (photoId) => `/api/inventory/items/${record.id}/photo?photoId=${encodeURIComponent(photoId)}&v=${record.version}`,
    ) ?? (record.photoUrl ? [record.photoUrl] : []),
    servicePhotoUrl: record.servicePhotoUrl ?? null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    maintenanceStartedAt: record.maintenanceStartedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    decommissionedUsage:
      record.status === "decommissioned_in_use" &&
      record.decommissionedUsageStartedAt
        ? {
            reason: record.decommissionedUsageReason ?? null,
            adminComment: record.decommissionedUsageComment ?? null,
            startedAt: record.decommissionedUsageStartedAt.toISOString(),
            photoUrl: record.decommissionedUsagePhotoUrl ?? null,
          }
        : null,
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
