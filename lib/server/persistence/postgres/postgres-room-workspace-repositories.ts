import "server-only";

import type { QueryResultRow } from "pg";
import type {
  RoomWorkspaceItemRecord,
  RoomWorkspaceRecord,
  RoomWorkspaceRepositories,
  RoomWorkspaceRepository,
} from "@/lib/application/ports/room-workspace-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import {
  assertCollectionSize,
  COLLECTION_LIMITS,
  sqlCollectionLimit,
} from "@/lib/server/persistence/collection-limits";

const ROOMS = '"yu_inventory"."rooms"';
const BUILDINGS = '"yu_inventory"."buildings"';
const USERS = '"yu_inventory"."users"';
const ITEMS = '"yu_inventory"."items"';
const QR = '"yu_inventory"."qr_identifiers"';
const RESPONSIBILITY = '"yu_inventory"."responsibility_periods"';
const PHOTOS = '"yu_inventory"."photos"';

interface RoomRow extends QueryResultRow {
  id: string;
  designation: string;
  building_name: string;
  floor_number: number;
  floor_label: string | null;
  primary_responsible_id: string | null;
  primary_responsible_name: string | null;
  access_mode: RoomWorkspaceRecord["accessMode"];
}

interface ItemRow extends QueryResultRow {
  id: string;
  name: string;
  inventory_number: string;
  description: string | null;
  status: RoomWorkspaceItemRecord["status"];
  condition: RoomWorkspaceItemRecord["condition"];
  connection_status: RoomWorkspaceItemRecord["connectionStatus"];
  responsible_name: string | null;
  responsible_user_id: string | null;
  has_photo: boolean;
  created_at: Date;
}

export function createPostgresRoomWorkspaceRepositories(
  source: PostgresRepositorySource,
): RoomWorkspaceRepositories {
  return { rooms: new PostgresRoomWorkspaceRepository(source) };
}

class PostgresRoomWorkspaceRepository implements RoomWorkspaceRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async findRoomById(id: string) {
    const result = await this.source.query<RoomRow>(
      roomSelect("where r.id = $1 and r.status = 'active'"),
      [id],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async findRoomByQr(canonicalKey: string) {
    const result = await this.source.query<RoomRow>(
      roomSelect(
        `join ${QR} q on q.room_id = r.id
           and q.status = 'active'
         where q.canonical_key = $1 and r.status = 'active'`,
      ),
      [canonicalKey],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async listRoomItems(roomId: string): Promise<RoomWorkspaceItemRecord[]> {
    const [result, localResult] = await Promise.all([
      this.source.query<ItemRow>(`select i.id, i.name, i.inventory_number, i.description, i.status,
              i.condition, i.connection_status, responsible.full_name as responsible_name,
              period.responsible_user_id,
              exists(
                select 1 from ${PHOTOS} photo
                 where photo.item_id = i.id and photo.purpose = 'item'
                   and photo.status = 'attached'
              ) as has_photo,
              i.created_at
         from ${ITEMS} i
         left join lateral (
           select responsible_user_id
             from ${RESPONSIBILITY}
            where item_id = i.id and ended_at is null
            order by started_at desc
            limit 1
         ) period on true
         left join ${USERS} responsible on responsible.id = period.responsible_user_id
        where i.room_id = $1 and i.archived_at is null
          and i.item_section = 'general'
        order by i.name, i.inventory_number
        ${sqlCollectionLimit(COLLECTION_LIMITS.roomWorkspaceItems)}`,
      [roomId],
      ),
      this.source.query<ItemRow>(`select g.id, i.name, g.barcode_value as inventory_number,
              i.description, i.status, i.condition, i.connection_status,
              responsible.full_name as responsible_name, g.responsible_user_id,
              exists(
                select 1 from ${PHOTOS} photo
                 where photo.item_id = i.id and photo.purpose = 'item'
                   and photo.status = 'attached'
              ) as has_photo,
              g.created_at
         from "yu_inventory"."local_item_groups" g
         join ${ITEMS} i on i.id = g.item_id
         join ${USERS} responsible on responsible.id = g.responsible_user_id
        where g.room_id = $1 and g.status = 'active'
          and i.item_section = 'general'
        order by i.name, g.barcode_value
        ${sqlCollectionLimit(COLLECTION_LIMITS.roomWorkspaceItems)}`,
      [roomId],
      ),
    ]);
    const regular = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      inventoryNumber: row.inventory_number,
      description: row.description,
      status: row.status,
      condition: row.condition,
      connectionStatus: row.connection_status,
      responsibleName: row.responsible_name,
      responsibleUserId: row.responsible_user_id,
      hasPhoto: row.has_photo,
      createdAt: new Date(row.created_at),
      href: `/items/${row.id}`,
    }));
    const local = localResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      inventoryNumber: row.inventory_number,
      description: row.description,
      status: row.status,
      condition: row.condition,
      connectionStatus: row.connection_status,
      responsibleName: row.responsible_name,
      responsibleUserId: row.responsible_user_id,
      hasPhoto: row.has_photo,
      createdAt: new Date(row.created_at),
      href: `/local-barcodes/${row.id}`,
    }));
    return assertCollectionSize(
      [...regular, ...local].sort((left, right) =>
        left.name.localeCompare(right.name, "ru") ||
        left.inventoryNumber.localeCompare(right.inventoryNumber, "ru"),
      ),
      COLLECTION_LIMITS.roomWorkspaceItems,
    );
  }
}

function roomSelect(joinAndWhere: string) {
  return `select r.id, r.designation, b.name as building_name,
                 r.floor_number, r.floor_label, r.primary_responsible_id,
                 r.access_mode,
                 responsible.full_name as primary_responsible_name
            from ${ROOMS} r
            join ${BUILDINGS} b on b.id = r.building_id
            left join ${USERS} responsible on responsible.id = r.primary_responsible_id
            ${joinAndWhere}
           limit 1`;
}

function mapRoom(row: RoomRow): RoomWorkspaceRecord {
  return {
    id: row.id,
    designation: row.designation,
    buildingName: row.building_name,
    floorNumber: Number(row.floor_number),
    floorLabel: row.floor_label,
    primaryResponsibleId: row.primary_responsible_id,
    primaryResponsibleName: row.primary_responsible_name,
    accessMode: row.access_mode,
  };
}
