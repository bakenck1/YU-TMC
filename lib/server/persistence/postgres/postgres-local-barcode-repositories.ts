import "server-only";

import type { QueryResultRow } from "pg";
import type {
  InsertLocalBarcodeGroup,
  LocalBarcodeActorRecord,
  LocalBarcodeEventRecord,
  LocalBarcodeGroupRecord,
  LocalBarcodeItemRecord,
  LocalBarcodeRecipientRecord,
  LocalBarcodeRepositories,
  LocalBarcodeRepository,
} from "@/lib/application/ports/local-barcode-repositories";
import { PostgresIdempotencyRequestRepository } from "@/lib/server/persistence/postgres/postgres-inventory-concurrency-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const S = '"yu_inventory"';

type ItemRow = QueryResultRow & {
  id: string;
  name: string;
  inventory_number: string;
  quantity: number;
  version: number;
  status: LocalBarcodeItemRecord["status"];
  responsible_user_id: string | null;
  responsible_name: string | null;
  room_id: string;
  room_designation: string;
  building_id: string;
  building_name: string;
};

type GroupRow = QueryResultRow & {
  id: string;
  item_id: string;
  item_name: string;
  original_barcode: string;
  parent_group_id: string | null;
  sequence_number: string;
  barcode_value: string;
  barcode_key: string;
  quantity: number;
  responsible_user_id: string;
  responsible_name: string;
  room_id: string;
  room_designation: string;
  building_id: string;
  building_name: string;
  previous_responsible_user_id: string | null;
  previous_room_id: string | null;
  created_by: string;
  created_at: Date;
  transferred_at: Date;
  status: LocalBarcodeGroupRecord["status"];
  cancelled_by: string | null;
  cancelled_by_name: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  version: number;
};

type EventRow = QueryResultRow & {
  id: string;
  event_type: LocalBarcodeEventRecord["eventType"];
  actor_id: string;
  actor_name: string;
  from_responsible_user_id: string | null;
  from_responsible_name: string | null;
  to_responsible_user_id: string | null;
  to_responsible_name: string | null;
  quantity: number;
  room_id: string;
  room_designation: string;
  building_id: string;
  building_name: string;
  reason: string | null;
  occurred_at: Date;
};

export function createPostgresLocalBarcodeRepositories(source: PostgresRepositorySource): LocalBarcodeRepositories {
  return {
    idempotency: new PostgresIdempotencyRequestRepository(source),
    localBarcodes: new PostgresLocalBarcodeRepository(source),
  };
}

class PostgresLocalBarcodeRepository implements LocalBarcodeRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async findActorForUpdate(id: string): Promise<LocalBarcodeActorRecord | null> {
    const result = await this.source.query<QueryResultRow & { id: string; role: LocalBarcodeActorRecord["role"]; is_active: boolean; deleted_at: Date | null; version: number }>(
      `select id, role, is_active, deleted_at, version from ${S}."users" where id = $1 for no key update`, [id]);
    const row = result.rows[0];
    return row ? { id: row.id, role: row.role, active: row.is_active, deletedAt: row.deleted_at, version: Number(row.version) } : null;
  }

  async findRecipientForUpdate(id: string): Promise<LocalBarcodeRecipientRecord | null> {
    const result = await this.source.query<QueryResultRow & { id: string; full_name: string; role: LocalBarcodeRecipientRecord["role"]; is_active: boolean; deleted_at: Date | null; default_room_id: string | null }>(
      `select id, full_name, role, is_active, deleted_at, default_room_id
         from ${S}."users" where id = $1 for no key update`, [id]);
    const row = result.rows[0];
    if (!row) return null;
    const room = row.default_room_id
      ? await this.source.query<QueryResultRow & { status: string }>(
          `select status from ${S}."rooms" where id = $1 for no key update`,
          [row.default_room_id],
        )
      : null;
    return { id: row.id, fullName: row.full_name, role: row.role, active: row.is_active, deletedAt: row.deleted_at, defaultRoomId: row.default_room_id, roomActive: room?.rows[0]?.status === "active" };
  }

  async findItemForUpdate(id: string) { return this.queryItem(id, true); }
  async findItem(id: string) { return this.queryItem(id, false); }

  private async queryItem(id: string, lock: boolean): Promise<LocalBarcodeItemRecord | null> {
    const result = await this.source.query<ItemRow>(
      `select i.id, i.name, i.inventory_number, i.quantity, i.version, i.status,
              rp.responsible_user_id, responsible.full_name as responsible_name,
              r.id as room_id, r.designation as room_designation,
              b.id as building_id, b.name as building_name
         from ${S}."items" i
         join ${S}."rooms" r on r.id = i.room_id
         join ${S}."buildings" b on b.id = r.building_id
         left join ${S}."responsibility_periods" rp on rp.item_id = i.id and rp.ended_at is null
         left join ${S}."users" responsible on responsible.id = rp.responsible_user_id
        where i.id = $1 ${lock ? "for update of i" : ""}`, [id]);
    const row = result.rows[0];
    return row ? { id: row.id, name: row.name, inventoryNumber: row.inventory_number, quantity: Number(row.quantity), version: Number(row.version), status: row.status, responsibleUserId: row.responsible_user_id, responsibleName: row.responsible_name, roomId: row.room_id, roomDesignation: row.room_designation, buildingId: row.building_id, buildingName: row.building_name } : null;
  }

  async findGroupForUpdate(id: string) { return this.queryGroup("g.id = $1", id, true); }
  async findGroup(id: string) { return this.queryGroup("g.id = $1", id, false); }
  async findGroupByBarcodeKey(key: string) { return this.queryGroup("g.barcode_key = $1", key, false); }

  private async queryGroup(predicate: string, value: string, lock: boolean): Promise<LocalBarcodeGroupRecord | null> {
    const result = await this.source.query<GroupRow>(
      `select g.*, i.name as item_name, i.inventory_number as original_barcode,
              responsible.full_name as responsible_name, cancelled.full_name as cancelled_by_name,
              r.designation as room_designation, b.id as building_id, b.name as building_name
         from ${S}."local_item_groups" g
         join ${S}."items" i on i.id = g.item_id
         join ${S}."users" responsible on responsible.id = g.responsible_user_id
         join ${S}."rooms" r on r.id = g.room_id
         join ${S}."buildings" b on b.id = r.building_id
         left join ${S}."users" cancelled on cancelled.id = g.cancelled_by
        where ${predicate} ${lock ? "for update of g" : ""} limit 1`, [value]);
    return result.rows[0] ? mapGroup(result.rows[0]) : null;
  }

  async listGroups(itemId: string): Promise<LocalBarcodeGroupRecord[]> {
    const result = await this.source.query<GroupRow>(
      `select g.*, i.name as item_name, i.inventory_number as original_barcode,
              responsible.full_name as responsible_name, cancelled.full_name as cancelled_by_name,
              r.designation as room_designation, b.id as building_id, b.name as building_name
         from ${S}."local_item_groups" g
         join ${S}."items" i on i.id = g.item_id
         join ${S}."users" responsible on responsible.id = g.responsible_user_id
         join ${S}."rooms" r on r.id = g.room_id
         join ${S}."buildings" b on b.id = r.building_id
         left join ${S}."users" cancelled on cancelled.id = g.cancelled_by
        where g.item_id = $1 order by g.created_at, g.id`, [itemId]);
    return result.rows.map(mapGroup);
  }

  async listEvents(groupId: string): Promise<LocalBarcodeEventRecord[]> {
    const result = await this.source.query<EventRow>(
      `select e.*, actor.full_name as actor_name, source.full_name as from_responsible_name,
              target.full_name as to_responsible_name, r.designation as room_designation,
              b.id as building_id, b.name as building_name
         from ${S}."local_item_group_events" e
         join ${S}."users" actor on actor.id = e.actor_id
         left join ${S}."users" source on source.id = e.from_responsible_user_id
         left join ${S}."users" target on target.id = e.to_responsible_user_id
         join ${S}."rooms" r on r.id = e.room_id join ${S}."buildings" b on b.id = r.building_id
        where e.group_id = $1 order by e.occurred_at, e.id`, [groupId]);
    return result.rows.map((row) => ({ id: row.id, eventType: row.event_type, actorId: row.actor_id, actorName: row.actor_name, fromResponsibleUserId: row.from_responsible_user_id, fromResponsibleName: row.from_responsible_name, toResponsibleUserId: row.to_responsible_user_id, toResponsibleName: row.to_responsible_name, quantity: Number(row.quantity), roomId: row.room_id, roomDesignation: row.room_designation, buildingId: row.building_id, buildingName: row.building_name, reason: row.reason, occurredAt: row.occurred_at }));
  }

  async allocatedQuantity(itemId: string): Promise<number> {
    const result = await this.source.query<QueryResultRow & { total: string }>(`select coalesce(sum(quantity), 0)::text as total from ${S}."local_item_groups" where item_id = $1 and status = 'active'`, [itemId]);
    return Number(result.rows[0]?.total ?? 0);
  }
  async isBarcodeRegistered(key: string): Promise<boolean> {
    const result = await this.source.query(
      `select 1 from ${S}."barcode_registry" where canonical_key = $1`,
      [key],
    );
    return (result.rowCount ?? 0) > 0;
  }
  async advanceItemVersion(itemId: string, version: number): Promise<boolean> {
    const result = await this.source.query(`update ${S}."items" set version=version+1,updated_at=now() where id=$1 and version=$2`, [itemId,version]);
    return result.rowCount === 1;
  }
  async nextSequence(): Promise<bigint> {
    const result = await this.source.query<QueryResultRow & { value: string }>(
      `select nextval('"yu_inventory"."local_barcode_sequence"')::text as value`,
    );
    return BigInt(result.rows[0]!.value);
  }
  async insertGroup(input: InsertLocalBarcodeGroup): Promise<void> {
    await this.source.query(`insert into ${S}."local_item_groups"
      (id,item_id,parent_group_id,sequence_number,barcode_value,barcode_key,quantity,responsible_user_id,room_id,previous_responsible_user_id,previous_room_id,created_by,created_at,transferred_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`, [input.id,input.itemId,input.parentGroupId,input.sequenceNumber.toString(),input.barcodeValue,input.barcodeKey,input.quantity,input.responsibleUserId,input.roomId,input.previousResponsibleUserId,input.previousRoomId,input.createdBy,input.occurredAt]);
  }
  async reduceGroupQuantity(id: string, version: number, quantity: number): Promise<boolean> {
    const result = await this.source.query(`update ${S}."local_item_groups" set quantity=quantity-$3, version=version+1 where id=$1 and version=$2 and status='active' and quantity>$3`, [id,version,quantity]);
    return result.rowCount === 1;
  }
  async increaseGroupQuantity(id: string, quantity: number): Promise<boolean> {
    const result = await this.source.query(`update ${S}."local_item_groups" set quantity=quantity+$2, version=version+1 where id=$1 and status='active'`, [id,quantity]);
    return result.rowCount === 1;
  }
  async transferWholeGroup(input: { id: string; version: number; responsibleUserId: string; roomId: string; transferredAt: Date }): Promise<boolean> {
    const result = await this.source.query(`update ${S}."local_item_groups" set responsible_user_id=$3,room_id=$4,transferred_at=$5,version=version+1 where id=$1 and version=$2 and status='active'`, [input.id,input.version,input.responsibleUserId,input.roomId,input.transferredAt]);
    return result.rowCount === 1;
  }
  async cancelGroup(input: { id: string; version: number; cancelledBy: string; cancelledAt: Date; reason: string }): Promise<boolean> {
    const result = await this.source.query(`update ${S}."local_item_groups" set status='cancelled',cancelled_by=$3,cancelled_at=$4,cancellation_reason=$5,version=version+1 where id=$1 and version=$2 and status='active'`, [input.id,input.version,input.cancelledBy,input.cancelledAt,input.reason]);
    return result.rowCount === 1;
  }
  async countActiveChildren(id: string): Promise<number> {
    const result = await this.source.query<QueryResultRow & { count: string }>(`select count(*)::text as count from ${S}."local_item_groups" where parent_group_id=$1 and status='active'`, [id]);
    return Number(result.rows[0]?.count ?? 0);
  }
  async insertEvent(input: { id: string; groupId: string; eventType: LocalBarcodeEventRecord["eventType"]; actorId: string; fromResponsibleUserId: string | null; toResponsibleUserId: string | null; quantity: number; roomId: string; reason: string | null; occurredAt: Date }): Promise<void> {
    await this.source.query(`insert into ${S}."local_item_group_events" (id,group_id,event_type,actor_id,from_responsible_user_id,to_responsible_user_id,quantity,room_id,reason,occurred_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [input.id,input.groupId,input.eventType,input.actorId,input.fromResponsibleUserId,input.toResponsibleUserId,input.quantity,input.roomId,input.reason,input.occurredAt]);
  }
  async appendAudit(input: { id: string; actorId: string; actorRole: LocalBarcodeActorRecord["role"]; groupId: string; revision: number; action: string; beforeValues: Record<string, unknown> | null; afterValues: Record<string, unknown> | null; reason: string | null; administrative: boolean; occurredAt: Date }): Promise<void> {
    await this.source.query(`insert into ${S}."audit_records" (id,actor_id,actor_role_snapshot,subject_kind,subject_id,subject_revision,action,before_values,after_values,reason,is_administrative_exception,occurred_at) values ($1,$2,$3,'local_item_group',$4,$5,$6,$7,$8,$9,$10,$11)`, [input.id,input.actorId,input.actorRole,input.groupId,input.revision,input.action,input.beforeValues,input.afterValues,input.reason,input.administrative,input.occurredAt]);
  }
}

function mapGroup(row: GroupRow): LocalBarcodeGroupRecord {
  return { id: row.id, itemId: row.item_id, itemName: row.item_name, originalBarcode: row.original_barcode, parentGroupId: row.parent_group_id, sequenceNumber: BigInt(row.sequence_number), barcodeValue: row.barcode_value, barcodeKey: row.barcode_key, quantity: Number(row.quantity), responsibleUserId: row.responsible_user_id, responsibleName: row.responsible_name, roomId: row.room_id, roomDesignation: row.room_designation, buildingId: row.building_id, buildingName: row.building_name, previousResponsibleUserId: row.previous_responsible_user_id, previousRoomId: row.previous_room_id, createdBy: row.created_by, createdAt: row.created_at, transferredAt: row.transferred_at, status: row.status, cancelledBy: row.cancelled_by, cancelledByName: row.cancelled_by_name, cancelledAt: row.cancelled_at, cancellationReason: row.cancellation_reason, version: Number(row.version) };
}
