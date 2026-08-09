import "server-only";

import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";

import type {
  AppendItemAuditRecord,
  ArchiveInventoryItemRecord,
  ChangeItemComponentRecord,
  InsertInventoryItemRecord,
  InsertInventoryItemCommentAttachmentRecord,
  InsertItemQrRecord,
  InsertServiceItemPhotoRecord,
  InventoryItemRecord,
  InventoryItemAuditRecord,
  InventoryItemCommentRecord,
  InventoryItemOperationRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
  ReplaceItemQrRecord,
  RemoveInventoryItemPhotoRecord,
  ResolveMaintenanceItemRecord,
  StoredInventoryItemCommentAttachment,
  UpdateInventoryItemContentRecord,
  UpdateInventoryItemPhotoRecord,
  UpdateInventoryItemProtectedRecord,
  UpdateInventoryItemStatusRecord,
} from "@/lib/application/ports/inventory-item-repositories";
import { ApplicationError } from "@/lib/domain/application-error";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const ITEMS = '"yu_inventory"."items"';
const ROOMS = '"yu_inventory"."rooms"';
const BUILDINGS = '"yu_inventory"."buildings"';
const USERS = '"yu_inventory"."users"';
const QR = '"yu_inventory"."qr_identifiers"';
const PHOTOS = '"yu_inventory"."photos"';
const HISTORY = '"yu_inventory"."item_inventory_number_history"';
const AUDIT = '"yu_inventory"."audit_records"';
const COMPONENTS = '"yu_inventory"."item_components"';
const COMMENT_ATTACHMENTS = '"yu_inventory"."item_comment_attachments"';

interface ItemRow extends QueryResultRow {
  id: string;
  name: string;
  description: string | null;
  item_type: string;
  brand: string | null;
  model: string | null;
  quantity: number;
  unit_price: string | number;
  room_id: string;
  room_designation: string;
  floor_number: number;
  building_id: string;
  building_name: string;
  inventory_number_kind: InventoryItemRecord["inventoryNumberKind"];
  inventory_number: string;
  status: InventoryItemRecord["status"];
  condition: InventoryItemRecord["condition"];
  connection_status: InventoryItemRecord["connectionStatus"];
  qr_code: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  room_responsible_id: string | null;
  photo_url: string | null;
  photo_id: string | null;
  service_photo_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  maintenance_started_at: Date | null;
  archived_at: Date | null;
}

export function createPostgresInventoryItemRepositories(
  source: PostgresRepositorySource,
): InventoryItemRepositories {
  return { items: new PostgresInventoryItemRepository(source) };
}

class PostgresInventoryItemRepository implements InventoryItemRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async roomExists(id: string): Promise<boolean> {
    const result = await this.source.query<{ id: string }>(
      `select id from ${ROOMS}
        where id = $1 and status = 'active'
        for update`,
      [id],
    );
    return result.rowCount === 1;
  }

  async listItems(): Promise<InventoryItemRecord[]> {
    const result = await this.source.query<ItemRow>(itemSelect(""), []);
    return result.rows.map(mapItem);
  }

  async listItemsAssignedTo(userId: string): Promise<InventoryItemRecord[]> {
    const result = await this.source.query<ItemRow>(
      itemSelect("where rp.responsible_user_id = $1 or r.primary_responsible_id = $1"),
      [userId],
    );
    return result.rows.map(mapItem);
  }

  async listDecommissionedItems(): Promise<InventoryItemRecord[]> {
    const result = await this.source.query<ItemRow>(
      itemSelect("where i.status = 'decommissioned'"),
      [],
    );
    return result.rows.map(mapItem);
  }

  async listDecommissionedItemsAssignedTo(
    userId: string,
  ): Promise<InventoryItemRecord[]> {
    const result = await this.source.query<ItemRow>(
      itemSelect(
        "where (rp.responsible_user_id = $1 or r.primary_responsible_id = $1) and i.status = 'decommissioned'",
      ),
      [userId],
    );
    return result.rows.map(mapItem);
  }

  async findItemById(id: string): Promise<InventoryItemRecord | null> {
    const result = await this.source.query<ItemRow>(
      itemSelect("where i.id = $1"),
      [id],
    );
    return result.rows[0] ? mapItem(result.rows[0]) : null;
  }

  async listComponents(itemId: string): Promise<InventoryItemRecord[]> {
    const result = await this.source.query<ItemRow>(
      itemSelect(
        `where i.id in (
           select case
                    when left_item_id = $1 then right_item_id
                    else left_item_id
                  end
             from ${COMPONENTS}
            where left_item_id = $1 or right_item_id = $1
         )`,
      ),
      [itemId],
    );
    return result.rows.map(mapItem);
  }

  async listOperations(itemId: string): Promise<InventoryItemOperationRecord[]> {
    const result = await this.source.query<{
      id: string;
      kind: InventoryItemOperationRecord["kind"];
      action: string;
      actorName: string | null;
      actorEmail: string | null;
      targetName: string | null;
      fromLocation: string | null;
      toLocation: string | null;
      occurredAt: Date;
      beforeValues: Record<string, unknown> | null;
      afterValues: Record<string, unknown> | null;
    }>(
      `select a.id, 'item'::text as "kind", a.action,
              u.full_name as "actorName", u.email as "actorEmail",
              null::text as "targetName",
              a.before_values->>'roomLabel' as "fromLocation",
              a.after_values->>'roomLabel' as "toLocation",
              a.occurred_at as "occurredAt", a.before_values as "beforeValues",
              a.after_values as "afterValues"
         from ${AUDIT} a
         left join ${USERS} u on u.id = a.actor_id
        where a.subject_kind = 'item' and a.subject_id = $1
          and a.action in (
            'item.created',
            'item.content_updated',
            'item.photo_captured',
            'item.protected_fields_updated',
            'item.archived',
            'item.sent_to_service',
            'item.component_added',
            'item.component_removed'
          )
       union all
       select a.id, 'responsibility'::text as "kind", a.action,
              u.full_name as "actorName", u.email as "actorEmail",
              target.full_name as "targetName",
              null::text as "fromLocation", null::text as "toLocation",
              a.occurred_at as "occurredAt", a.before_values as "beforeValues",
              a.after_values as "afterValues"
         from ${AUDIT} a
         left join ${USERS} u on u.id = a.actor_id
         left join ${USERS} target on target.id::text =
           coalesce(a.after_values->>'responsibleUserId', a.after_values->>'responsibleId')
        where a.subject_kind = 'responsibility' and a.subject_id = $1
       union all
       select a.id, 'transfer'::text as "kind", a.action,
              u.full_name as "actorName", u.email as "actorEmail",
              target.full_name as "targetName",
              null::text as "fromLocation", null::text as "toLocation",
              a.occurred_at as "occurredAt", a.before_values as "beforeValues",
              a.after_values as "afterValues"
         from ${AUDIT} a
         join "yu_inventory"."transfers" t on t.id = a.subject_id
         left join ${USERS} u on u.id = a.actor_id
         left join ${USERS} target on target.id::text = case
           when a.action = 'transfer.overridden'
             and coalesce(a.after_values->>'outcome', t.override_outcome::text) = 'released'
             then null
           else coalesce(
             a.after_values->>'responsibleUserId',
             a.after_values->>'proposedResponsibleId',
             a.after_values->>'overrideResponsibleId',
             t.override_responsible_id::text,
             t.proposed_responsible_id::text
           )
         end
        where a.subject_kind = 'transfer' and t.item_id = $1
        order by "occurredAt" desc, id desc
        limit 100`,
      [itemId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      action: row.action,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      targetName: row.targetName,
      fromLocation: row.fromLocation,
      toLocation: row.toLocation,
      occurredAt: new Date(row.occurredAt),
      beforeValues: row.beforeValues,
      afterValues: row.afterValues,
    }));
  }

  async listComments(itemId: string): Promise<InventoryItemCommentRecord[]> {
    const result = await this.source.query<{
      id: string;
      author_name: string;
      author_email: string;
      message: string;
      created_at: Date;
      attachment_id: string | null;
      attachment_file_name: string | null;
      attachment_media_type: string | null;
      attachment_size_bytes: number | null;
    }>(
      `select a.id, u.full_name as author_name, u.email as author_email,
              a.after_values->>'message' as message, a.occurred_at as created_at,
              attachment.id as attachment_id,
              attachment.file_name as attachment_file_name,
              attachment.media_type as attachment_media_type,
              attachment.size_bytes as attachment_size_bytes
         from ${AUDIT} a
         join ${USERS} u on u.id = a.actor_id
         left join ${COMMENT_ATTACHMENTS} attachment on attachment.comment_id = a.id
        where a.subject_kind = 'item'
          and a.subject_id = $1
          and a.action = 'item.comment_added'
        order by a.occurred_at desc, a.id desc
        limit 200`,
      [itemId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      authorName: row.author_name,
      authorEmail: row.author_email,
      message: row.message,
      createdAt: new Date(row.created_at),
      attachment:
        row.attachment_id &&
        row.attachment_file_name &&
        row.attachment_media_type &&
        row.attachment_size_bytes
          ? {
              id: row.attachment_id,
              fileName: row.attachment_file_name,
              mediaType: row.attachment_media_type,
              sizeBytes: row.attachment_size_bytes,
            }
          : null,
    }));
  }

  async insertCommentAttachment(
    input: InsertInventoryItemCommentAttachmentRecord,
  ): Promise<void> {
    try {
      await this.source.query(
        `insert into ${COMMENT_ATTACHMENTS}
           (id, comment_id, file_name, media_type, size_bytes, binary_data, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          input.commentId,
          input.fileName,
          input.mediaType,
          input.sizeBytes,
          input.binaryData,
          input.createdAt,
        ],
      );
    } catch (error) {
      const databaseError = error as { code?: string; constraint?: string };
      if (
        databaseError.code === "23514" &&
        databaseError.constraint === "item_comment_attachments_daily_quota"
      ) {
        throw new ApplicationError("rate_limited", "attachment_quota_exceeded", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async findCommentAttachment(
    itemId: string,
    commentId: string,
    attachmentId: string,
  ): Promise<StoredInventoryItemCommentAttachment | null> {
    const result = await this.source.query<{
      id: string;
      comment_id: string;
      item_id: string;
      file_name: string;
      media_type: string;
      size_bytes: number;
      binary_data: Uint8Array;
      created_at: Date;
    }>(
      `select attachment.id, attachment.comment_id, audit.subject_id as item_id,
              attachment.file_name, attachment.media_type, attachment.size_bytes,
              attachment.binary_data, attachment.created_at
         from ${COMMENT_ATTACHMENTS} attachment
         join ${AUDIT} audit on audit.id = attachment.comment_id
        where attachment.id = $1
          and attachment.comment_id = $2
          and audit.subject_kind = 'item'
          and audit.subject_id = $3
          and audit.action = 'item.comment_added'
        limit 1`,
      [attachmentId, commentId, itemId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          commentId: row.comment_id,
          itemId: row.item_id,
          fileName: row.file_name,
          mediaType: row.media_type,
          sizeBytes: row.size_bytes,
          binaryData: new Uint8Array(row.binary_data),
          createdAt: new Date(row.created_at),
        }
      : null;
  }

  async searchComponentCandidates(
    itemId: string,
    query: string,
    limit: number,
  ): Promise<InventoryItemRecord[]> {
    const pattern = `%${query}%`;
    const result = await this.source.query<ItemRow>(
      itemSelect(
        `where i.id <> $1
           and i.status <> 'decommissioned'
           and not exists (
             select 1
               from ${COMPONENTS} component
              where (component.left_item_id = $1 and component.right_item_id = i.id)
                 or (component.right_item_id = $1 and component.left_item_id = i.id)
           )
           and ($2 = '%%'
             or i.name ilike $2
             or i.item_type ilike $2
             or coalesce(i.brand, '') ilike $2
             or coalesce(i.model, '') ilike $2
             or i.inventory_number ilike $2)`,
        "limit $3",
      ),
      [itemId, pattern, limit],
    );
    return result.rows.map(mapItem);
  }

  async insertComponent(input: ChangeItemComponentRecord): Promise<void> {
    try {
      await this.source.query(
        `insert into ${COMPONENTS}
           (left_item_id, right_item_id, created_by, created_at)
         values ($1, $2, $3, $4)`,
        [
          input.leftItemId,
          input.rightItemId,
          input.actorId,
          input.occurredAt,
        ],
      );
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new ApplicationError("conflict", "item_component_already_exists", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async deleteComponent(input: ChangeItemComponentRecord): Promise<boolean> {
    const result = await this.source.query(
      `delete from ${COMPONENTS}
        where left_item_id = $1 and right_item_id = $2`,
      [input.leftItemId, input.rightItemId],
    );
    return result.rowCount === 1;
  }

  async insertItem(input: InsertInventoryItemRecord): Promise<InventoryItemRecord> {
    try {
      const result = await this.source.query<ItemRow>(
        `insert into ${ITEMS}
           (id, name, description, item_type, brand, model, quantity, unit_price,
            room_id, inventory_number_kind, inventory_number, inventory_number_key,
            created_by, updated_by, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $14)
         returning id`,
        [
          input.id,
          input.name,
          input.description,
          input.itemType,
          input.brand,
          input.model,
          input.quantity,
          input.unitPrice,
          input.roomId,
          input.inventoryNumberKind,
          input.inventoryNumber,
          input.inventoryNumberKey,
          input.actorId,
          input.occurredAt,
        ],
      );
      if (!result.rows[0]) throw new Error("item_insert_failed");
      const item = await this.findItemById(input.id);
      if (!item) throw new Error("item_insert_failed");
      if (input.inventoryNumberKind === "temporary") {
        await this.source.query(
          `insert into ${HISTORY}
             (id, item_id, kind, value, comparison_key, assigned_by)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            `${input.id.slice(0, 8)}-0000-4000-8000-${input.id.slice(-12)}`,
            input.id,
            input.inventoryNumberKind,
            input.inventoryNumber,
            input.inventoryNumberKey,
            input.actorId,
          ],
        );
      }
      return item;
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new ApplicationError("conflict", "inventory_number_already_exists", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async updateItemContent(
    input: UpdateInventoryItemContentRecord,
  ): Promise<InventoryItemRecord | null> {
    const result = await this.source.query<{ id: string }>(
      `update ${ITEMS}
       set name = $2, description = $3, item_type = $4, brand = $5,
           model = $6, quantity = $7, unit_price = $8, updated_by = $9,
           updated_at = $10, version = version + 1
       where id = $1 and version = $11 and status <> 'decommissioned'`,
      [
        input.id,
        input.name,
        input.description,
        input.itemType,
        input.brand,
        input.model,
        input.quantity,
        input.unitPrice,
        input.actorId,
        input.occurredAt,
        input.expectedVersion,
      ],
    );
    if (result.rowCount !== 1) return null;
    return this.findItemById(input.id);
  }

  async updateItemPhoto(
    input: UpdateInventoryItemPhotoRecord,
  ): Promise<InventoryItemRecord | null> {
    const itemUpdate = await this.source.query<{ id: string }>(
      `update ${ITEMS}
       set updated_by = $2, updated_at = $3, version = version + 1
       where id = $1 and version = $4 and status <> 'decommissioned'`,
      [input.id, input.actorId, input.occurredAt, input.expectedVersion],
    );
    if (itemUpdate.rowCount !== 1) return null;

    await this.source.query(
      `update ${PHOTOS}
       set status = 'superseded', superseded_at = $2, version = version + 1
       where item_id = $1 and purpose = 'item' and status = 'attached'`,
      [input.id, input.occurredAt],
    );
    const objectKey = `database://items/${input.id}/${input.photoId}.jpg`;
    const checksum = createHash("sha256").update(input.bytes).digest("hex");
    await this.source.query(
      `insert into ${PHOTOS}
         (id, purpose, status, uploaded_by, original_object_key, preview_object_key,
          trusted_mime_type, byte_size, width, height, checksum_sha256,
          reserved_at, expires_at, attached_at, item_id, binary_data)
       values ($1, 'item', 'attached', $2, $3, $3, 'image/jpeg', $4, $5, $6, $7,
               $8, $9, $8, $10, $11)`,
      [
        input.photoId,
        input.actorId,
        objectKey,
        input.bytes.byteLength,
        input.width,
        input.height,
        checksum,
        input.occurredAt,
        new Date(input.occurredAt.getTime() + 24 * 60 * 60 * 1000),
        input.id,
        Buffer.from(input.bytes),
      ],
    );
    return this.findItemById(input.id);
  }

  async removeItemPhoto(
    input: RemoveInventoryItemPhotoRecord,
  ): Promise<InventoryItemRecord | null> {
    const itemUpdate = await this.source.query(
      `update ${ITEMS}
          set updated_by = $2, updated_at = $3, version = version + 1
        where id = $1 and version = $4 and status <> 'decommissioned'`,
      [input.id, input.actorId, input.occurredAt, input.expectedVersion],
    );
    if (itemUpdate.rowCount !== 1) return null;
    const removed = await this.source.query(
      `update ${PHOTOS}
          set status = 'removed', removed_at = $2, version = version + 1
        where item_id = $1 and purpose = 'item' and status = 'attached'`,
      [input.id, input.occurredAt],
    );
    if (removed.rowCount !== 1) return null;
    return this.findItemById(input.id);
  }

  async findItemPhoto(id: string) {
    const result = await this.source.query<{
      binary_data: Buffer | null;
      trusted_mime_type: string | null;
    }>(
      `select binary_data, trusted_mime_type
         from ${PHOTOS}
        where item_id = $1 and purpose = 'item' and status = 'attached'
        order by attached_at desc
        limit 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row?.binary_data || row.trusted_mime_type !== "image/jpeg") return null;
    return { bytes: row.binary_data, mimeType: "image/jpeg" as const };
  }

  async insertServiceItemPhoto(input: InsertServiceItemPhotoRecord): Promise<void> {
    const objectKey = `database://items/${input.itemId}/service/${input.id}.jpg`;
    const checksum = createHash("sha256").update(input.bytes).digest("hex");
    await this.source.query(
      `insert into ${PHOTOS}
         (id, purpose, status, uploaded_by, original_object_key, preview_object_key,
          trusted_mime_type, byte_size, width, height, checksum_sha256,
          reserved_at, expires_at, attached_at, item_id, binary_data)
       values ($1, 'service_request', 'attached', $2, $3, $3, 'image/jpeg',
               $4, $5, $6, $7, $8, $9, $8, $10, $11)`,
      [
        input.id,
        input.actorId,
        objectKey,
        input.bytes.byteLength,
        input.width,
        input.height,
        checksum,
        input.occurredAt,
        new Date(input.occurredAt.getTime() + 24 * 60 * 60 * 1000),
        input.itemId,
        Buffer.from(input.bytes),
      ],
    );
  }

  async findServiceItemPhoto(id: string) {
    const result = await this.source.query<{
      binary_data: Buffer | null;
      trusted_mime_type: string | null;
    }>(
      `select binary_data, trusted_mime_type
         from ${PHOTOS}
        where item_id = $1 and purpose = 'service_request' and status = 'attached'
        order by attached_at desc
        limit 1`,
      [id],
    );
    const row = result.rows[0];
    return row?.binary_data && row.trusted_mime_type === "image/jpeg"
      ? { bytes: row.binary_data, mimeType: "image/jpeg" as const }
      : null;
  }

  async updateItemProtected(
    input: UpdateInventoryItemProtectedRecord,
  ): Promise<InventoryItemRecord | null> {
    try {
      const result = await this.source.query<{ id: string }>(
        `update ${ITEMS}
         set room_id = $2, inventory_number_kind = $3,
             inventory_number = $4, inventory_number_key = $5,
             status = $6::"yu_inventory"."item_status",
             condition = $7::"yu_inventory"."item_condition",
             connection_status = $8::"yu_inventory"."connection_status",
             archived_by = case
               when $6::"yu_inventory"."item_status" = 'decommissioned'
                 then coalesce(archived_by, $9)
               else null
             end,
             archived_at = case
               when $6::"yu_inventory"."item_status" = 'decommissioned'
                 then coalesce(archived_at, $10)
               else null
             end,
             updated_by = $9, updated_at = $10,
             version = version + 1
         where id = $1 and version = $11`,
        [
          input.id,
          input.roomId,
          input.inventoryNumberKind,
          input.inventoryNumber,
          input.inventoryNumberKey,
          input.status,
          input.condition,
          input.connectionStatus,
          input.actorId,
          input.occurredAt,
          input.expectedVersion,
        ],
      );
      if (result.rowCount !== 1) return null;
      return this.findItemById(input.id);
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new ApplicationError("conflict", "inventory_number_already_exists", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async updateItemStatus(
    input: UpdateInventoryItemStatusRecord,
  ): Promise<InventoryItemRecord | null> {
    const result = await this.source.query<{ id: string }>(
      `update ${ITEMS}
       set status = $2, updated_by = $3, updated_at = $4,
           version = version + 1
       where id = $1 and version = $5 and archived_at is null`,
      [
        input.id,
        input.status,
        input.actorId,
        input.occurredAt,
        input.expectedVersion,
      ],
    );
    if (result.rowCount !== 1) return null;
    return this.findItemById(input.id);
  }

  async resolveMaintenanceItem(
    input: ResolveMaintenanceItemRecord,
  ): Promise<InventoryItemRecord | null> {
    const result = await this.source.query<{ id: string }>(
      `update ${ITEMS}
       set status = $2::"yu_inventory"."item_status",
           archived_by = case when $2 = 'decommissioned' then $3::uuid else null end,
           archived_at = case when $2 = 'decommissioned' then $4 else null end,
           updated_by = $3, updated_at = $4, version = version + 1
       where id = $1 and version = $5 and status = 'maintenance' and archived_at is null`,
      [input.id, input.status, input.actorId, input.occurredAt, input.expectedVersion],
    );
    if (result.rowCount !== 1) return null;
    return this.findItemById(input.id);
  }

  async archiveItem(
    input: ArchiveInventoryItemRecord,
  ): Promise<InventoryItemRecord | null> {
    const result = await this.source.query<{ id: string }>(
      `update ${ITEMS}
       set status = 'decommissioned',
           archived_by = $2,
           archived_at = $3,
           updated_by = $2,
           updated_at = $3,
           version = version + 1
       where id = $1 and version = $4 and archived_at is null`,
      [input.id, input.actorId, input.occurredAt, input.expectedVersion],
    );
    if (result.rowCount !== 1) return null;
    return this.findItemById(input.id);
  }

  async insertItemQr(input: InsertItemQrRecord): Promise<void> {
    try {
      await this.source.query(
        `insert into ${QR}
           (id, original_value, canonical_key, format, target_kind, role,
            item_id, created_by)
         values ($1, $2, $2, 'generated_v1', 'item', 'primary', $3, $4)`,
        [input.id, input.value, input.itemId, input.actorId],
      );
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new ApplicationError("conflict", "qr_already_exists", {
          cause: error,
        });
      }
      throw error;
    }
  }

  async replaceItemQr(input: ReplaceItemQrRecord): Promise<void> {
    const revoked = await this.source.query(
      `update ${QR}
          set status = 'revoked', revoked_by = $2, revoked_at = $3,
              revoke_reason = $4, version = version + 1
        where item_id = $1 and status = 'active' and role = 'primary'`,
      [input.itemId, input.actorId, input.revokedAt, input.revokeReason],
    );
    if (revoked.rowCount !== 1) {
      throw new ApplicationError("conflict", "active_qr_not_found");
    }
    await this.insertItemQr(input);
  }

  async appendAudit(input: AppendItemAuditRecord): Promise<void> {
    await this.source.query(
      `insert into ${AUDIT}
         (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
          subject_revision, action, before_values, after_values, occurred_at)
       values ($1, $2, $3, 'item', $4, $5, $6, $7, $8, $9)`,
      [
        input.id,
        input.actorId,
        input.actorRole,
        input.subjectId,
        input.subjectRevision,
        input.action,
        input.beforeValues,
        input.afterValues,
        input.occurredAt,
      ],
    );
  }

  async listAudit(itemId: string): Promise<InventoryItemAuditRecord[]> {
    const result = await this.source.query<{
      id: string;
      actor_id: string | null;
      actor_name: string | null;
      actor_email: string | null;
      actor_role_snapshot: InventoryItemAuditRecord["actorRole"];
      subject_revision: number | null;
      action: string;
      before_values: Record<string, unknown> | null;
      after_values: Record<string, unknown> | null;
      occurred_at: Date;
    }>(
      `select a.id, a.actor_id, u.full_name as actor_name, u.email as actor_email,
              a.actor_role_snapshot, a.subject_revision, a.action,
              a.before_values, a.after_values, a.occurred_at
         from ${AUDIT} a
         left join ${USERS} u on u.id = a.actor_id
        where a.subject_kind = 'item' and a.subject_id = $1
        order by a.occurred_at desc, a.id desc`,
      [itemId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      actorRole: row.actor_role_snapshot,
      subjectRevision: row.subject_revision,
      action: row.action,
      beforeValues: row.before_values,
      afterValues: row.after_values,
      occurredAt: row.occurred_at,
    }));
  }
}

function itemSelect(where: string, limit = "") {
  return `
    select i.id, i.name, i.description, i.item_type, i.brand, i.model,
           i.quantity, i.unit_price, i.room_id,
           r.designation as room_designation, r.floor_number,
           b.id as building_id, b.name as building_name,
           i.inventory_number_kind, i.inventory_number, i.status,
           i.condition, i.connection_status,
           q.original_value as qr_code,
           rp.responsible_user_id as responsible_id,
           u.full_name as responsible_name,
           r.primary_responsible_id as room_responsible_id,
           p.preview_object_key as photo_url, p.id as photo_id,
           service_photo.id as service_photo_id,
           i.version, i.created_at, i.updated_at,
           service_move.occurred_at as maintenance_started_at, i.archived_at
      from ${ITEMS} i
      join ${ROOMS} r on r.id = i.room_id
      join ${BUILDINGS} b on b.id = r.building_id
      left join lateral (
        select occurred_at
          from ${AUDIT}
         where subject_kind = 'item' and subject_id = i.id
           and action = 'item.sent_to_service'
         order by occurred_at desc, id desc
         limit 1
      ) service_move on true
      left join lateral (
        select original_value
          from ${QR}
         where item_id = i.id and status = 'active' and role = 'primary'
         limit 1
      ) q on true
      left join lateral (
        select responsible_user_id
          from "yu_inventory"."responsibility_periods"
         where item_id = i.id and ended_at is null
         order by started_at desc
         limit 1
      ) rp on true
      left join ${USERS} u on u.id = rp.responsible_user_id
      left join lateral (
        select id, preview_object_key
         from ${PHOTOS}
         where item_id = i.id and purpose = 'item'
           and status = 'attached'
         order by attached_at desc nulls last
         limit 1
      ) p on true
      left join lateral (
        select id
          from ${PHOTOS}
         where item_id = i.id and purpose = 'service_request'
           and status = 'attached'
         order by attached_at desc nulls last
         limit 1
      ) service_photo on true
      ${where}
     order by i.updated_at desc, i.id
     ${limit}`;
}

function mapItem(row: ItemRow): InventoryItemRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    itemType: row.item_type,
    brand: row.brand,
    model: row.model,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    roomId: row.room_id,
    roomDesignation: row.room_designation,
    floorNumber: Number(row.floor_number),
    buildingId: row.building_id,
    buildingName: row.building_name,
    inventoryNumberKind: row.inventory_number_kind,
    inventoryNumber: row.inventory_number,
    status: row.status,
    condition: row.condition,
    connectionStatus: row.connection_status,
    qrCode: row.qr_code,
    responsibleId: row.responsible_id,
    responsibleName: row.responsible_name,
    roomResponsibleId: row.room_responsible_id,
    photoUrl: row.photo_id
      ? `/api/inventory/items/${row.id}/photo?v=${row.version}`
      : row.photo_url,
    servicePhotoUrl: row.service_photo_id
      ? `/api/inventory/items/${row.id}/service-photo?v=${row.version}`
      : null,
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    maintenanceStartedAt: row.maintenance_started_at
      ? new Date(row.maintenance_started_at)
      : null,
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
  };
}

function postgresCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}
