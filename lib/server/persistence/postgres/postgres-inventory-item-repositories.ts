import "server-only";

import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";

import type {
  AppendItemAuditRecord,
  ArchiveInventoryItemRecord,
  InsertInventoryItemRecord,
  InsertItemQrRecord,
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
  ReplaceItemQrRecord,
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
  qr_code: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  photo_url: string | null;
  photo_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
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
    const result = await this.source.query<{ exists: boolean }>(
      `select exists(
         select 1 from ${ROOMS}
          where id = $1 and status = 'active'
       ) as exists`,
      [id],
    );
    return result.rows[0]?.exists === true;
  }

  async listItems(): Promise<InventoryItemRecord[]> {
    const result = await this.source.query<ItemRow>(itemSelect(""), []);
    return result.rows.map(mapItem);
  }

  async listItemsAssignedTo(userId: string): Promise<InventoryItemRecord[]> {
    const result = await this.source.query<ItemRow>(
      itemSelect("where rp.responsible_user_id = $1"),
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
        "where rp.responsible_user_id = $1 and i.status = 'decommissioned'",
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

  async updateItemProtected(
    input: UpdateInventoryItemProtectedRecord,
  ): Promise<InventoryItemRecord | null> {
    try {
      const result = await this.source.query<{ id: string }>(
        `update ${ITEMS}
         set room_id = $2, inventory_number_kind = $3,
             inventory_number = $4, inventory_number_key = $5,
             status = $6,
             archived_by = case
               when $6 = 'decommissioned' then coalesce(archived_by, $7)
               else null
             end,
             archived_at = case
               when $6 = 'decommissioned' then coalesce(archived_at, $8)
               else null
             end,
             updated_by = $7, updated_at = $8,
             version = version + 1
         where id = $1 and version = $9`,
        [
          input.id,
          input.roomId,
          input.inventoryNumberKind,
          input.inventoryNumber,
          input.inventoryNumberKey,
          input.status,
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
}

function itemSelect(where: string) {
  return `
    select i.id, i.name, i.description, i.item_type, i.brand, i.model,
           i.quantity, i.unit_price, i.room_id,
           r.designation as room_designation, r.floor_number,
           b.id as building_id, b.name as building_name,
           i.inventory_number_kind, i.inventory_number, i.status,
           q.original_value as qr_code,
           rp.responsible_user_id as responsible_id,
           u.full_name as responsible_name,
           p.preview_object_key as photo_url, p.id as photo_id,
           i.version, i.created_at, i.updated_at, i.archived_at
      from ${ITEMS} i
      join ${ROOMS} r on r.id = i.room_id
      join ${BUILDINGS} b on b.id = r.building_id
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
      ${where}
     order by i.updated_at desc, i.id`;
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
    qrCode: row.qr_code,
    responsibleId: row.responsible_id,
    responsibleName: row.responsible_name,
    photoUrl: row.photo_id
      ? `/api/inventory/items/${row.id}/photo?v=${row.version}`
      : row.photo_url,
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
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
