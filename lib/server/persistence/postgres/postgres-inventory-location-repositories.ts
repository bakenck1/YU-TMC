import "server-only";

import type { QueryResultRow } from "pg";

import type {
  AppendLocationAuditRecord,
  ArchiveBuildingRecord,
  ArchiveRoomRecord,
  BuildingRecord,
  InsertBuildingQrRecord,
  InsertBuildingRecord,
  InsertRoomQrRecord,
  InsertRoomRecord,
  InventoryLocationRepositories,
  InventoryLocationRepository,
  RoomRecord,
  UpdateRoomRecord,
  UpdateBuildingRecord,
} from "@/lib/application/ports/inventory-location-repositories";
import { ApplicationError } from "@/lib/domain/application-error";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const BUILDINGS = '"yu_inventory"."buildings"';
const ROOMS = '"yu_inventory"."rooms"';
const ITEMS = '"yu_inventory"."items"';
const QR_IDENTIFIERS = '"yu_inventory"."qr_identifiers"';
const AUDIT_RECORDS = '"yu_inventory"."audit_records"';
const USERS = '"yu_inventory"."users"';

interface BuildingRow extends QueryResultRow {
  id: string;
  name: string;
  name_key: string;
  address: string;
  address_key: string;
  qr_code: string;
  room_count: number;
  status: BuildingRecord["status"];
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface RoomRow extends QueryResultRow {
  id: string;
  building_id: string;
  designation: string;
  designation_key: string;
  floor_number: number;
  floor_label: string | null;
  primary_responsible_id: string | null;
  primary_responsible_name: string | null;
  qr_code: string;
  status: RoomRecord["status"];
  version: number;
  created_at: Date;
  updated_at: Date;
}

export function createPostgresInventoryLocationRepositories(
  source: PostgresRepositorySource,
): InventoryLocationRepositories {
  return {
    locations: new PostgresInventoryLocationRepository(source),
  };
}

class PostgresInventoryLocationRepository
  implements InventoryLocationRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async listBuildings(): Promise<BuildingRecord[]> {
    const result = await this.source.query<BuildingRow>(
      buildingSelect(
        "where b.status = 'active'",
        "order by b.name_key, b.id",
      ),
    );
    return result.rows.map(mapBuilding);
  }

  async findBuildingById(id: string): Promise<BuildingRecord | null> {
    const result = await this.source.query<BuildingRow>(
      buildingSelect("where b.id = $1"),
      [id],
    );
    return result.rows[0] ? mapBuilding(result.rows[0]) : null;
  }

  async findBuildingByIdForUpdate(id: string): Promise<BuildingRecord | null> {
    const result = await this.source.query<BuildingRow>(
      `select b.*, ''::text as qr_code, 0::int as room_count
         from ${BUILDINGS} b
        where b.id = $1
        for update`,
      [id],
    );
    return result.rows[0] ? mapBuilding(result.rows[0]) : null;
  }

  async insertBuilding(input: InsertBuildingRecord): Promise<BuildingRecord> {
    const result = await this.source.query<BuildingRow>(
      `insert into ${BUILDINGS}
         (id, name, name_key, address, address_key, created_by, updated_by,
          created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $6, $7, $7)
       returning *, ''::text as qr_code, 0::int as room_count`,
      [
        input.id,
        input.name,
        input.nameKey,
        input.address,
        input.addressKey,
        input.actorId,
        input.occurredAt,
      ],
    );
    return mapRequiredBuilding(result.rows[0]);
  }

  async updateBuilding(
    input: UpdateBuildingRecord,
  ): Promise<BuildingRecord | null> {
    const result = await this.source.query<BuildingRow>(
      `update ${BUILDINGS}
       set name = $2,
           name_key = $3,
           address = $4,
           address_key = $5,
           updated_by = $6,
           updated_at = $7,
           version = version + 1
       where id = $1 and version = $8 and status = 'active'
       returning *, ''::text as qr_code, 0::int as room_count`,
      [
        input.id,
        input.name,
        input.nameKey,
        input.address,
        input.addressKey,
        input.actorId,
        input.occurredAt,
        input.expectedVersion,
      ],
    );
    return result.rows[0] ? mapBuilding(result.rows[0]) : null;
  }

  async archiveBuilding(
    input: ArchiveBuildingRecord,
  ): Promise<BuildingRecord | null> {
    const result = await this.source.query<BuildingRow>(
      `update ${BUILDINGS}
       set status = 'archived',
           archived_by = $2,
           archived_at = $3,
           updated_by = $2,
           updated_at = $3,
           version = version + 1
       where id = $1 and version = $4 and status = 'active'
       returning *, ''::text as qr_code, 0::int as room_count`,
      [input.id, input.actorId, input.occurredAt, input.expectedVersion],
    );
    return result.rows[0] ? mapBuilding(result.rows[0]) : null;
  }

  async countActiveRooms(buildingId: string): Promise<number> {
    const result = await this.source.query<{ count: number } & QueryResultRow>(
      `select count(*)::int as count from ${ROOMS}
       where building_id = $1 and status = 'active'`,
      [buildingId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async insertBuildingQr(input: InsertBuildingQrRecord): Promise<void> {
    try {
      await this.source.query(
        `insert into ${QR_IDENTIFIERS}
           (id, original_value, canonical_key, format, target_kind, role,
            building_id, created_by)
         values ($1, $2, $2, 'generated_v1', 'building', 'primary', $3, $4)`,
        [input.id, input.value, input.buildingId, input.actorId],
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

  async appendAudit(input: AppendLocationAuditRecord): Promise<void> {
    await this.source.query(
      `insert into ${AUDIT_RECORDS}
         (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
          subject_revision, action, before_values, after_values, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.actorId,
        input.actorRole,
        input.subjectKind,
        input.subjectId,
        input.subjectRevision,
        input.action,
        input.beforeValues,
        input.afterValues,
        input.occurredAt,
      ],
    );
  }

  async listRooms(buildingId: string): Promise<RoomRecord[]> {
    const result = await this.source.query<RoomRow>(
      roomSelect("where r.building_id = $1 and r.status = 'active'"),
      [buildingId],
    );
    return result.rows.map(mapRoom);
  }

  async findRoomById(id: string): Promise<RoomRecord | null> {
    const result = await this.source.query<RoomRow>(
      roomSelect("where r.id = $1"),
      [id],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async findRoomByIdForUpdate(id: string): Promise<RoomRecord | null> {
    const result = await this.source.query<RoomRow>(
      `select r.*, null::text as primary_responsible_name,
              ''::text as qr_code
         from ${ROOMS} r
        where r.id = $1
        for update`,
      [id],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async insertRoom(input: InsertRoomRecord): Promise<RoomRecord> {
    const result = await this.source.query<RoomRow>(
      `insert into ${ROOMS}
         (id, building_id, designation, designation_key, floor_number,
          floor_label, primary_responsible_id, created_by, updated_by,
          created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $9)
       returning *, ''::text as qr_code,
         null::text as primary_responsible_name`,
      [
        input.id,
        input.buildingId,
        input.designation,
        input.designationKey,
        input.floorNumber,
        input.floorLabel,
        input.primaryResponsibleId,
        input.actorId,
        input.occurredAt,
      ],
    );
    return mapRequiredRoom(result.rows[0]);
  }

  async updateRoom(input: UpdateRoomRecord): Promise<RoomRecord | null> {
    const result = await this.source.query<RoomRow>(
      `update ${ROOMS}
       set designation = $2,
           designation_key = $3,
           floor_number = $4,
           floor_label = $5,
           primary_responsible_id = $6,
           updated_by = $7,
           updated_at = $8,
           version = version + 1
       where id = $1 and version = $9 and status = 'active'
       returning *, ''::text as qr_code,
         null::text as primary_responsible_name`,
      [
        input.id,
        input.designation,
        input.designationKey,
        input.floorNumber,
        input.floorLabel,
        input.primaryResponsibleId,
        input.actorId,
        input.occurredAt,
        input.expectedVersion,
      ],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async archiveRoom(input: ArchiveRoomRecord): Promise<RoomRecord | null> {
    const result = await this.source.query<RoomRow>(
      `update ${ROOMS}
       set status = 'archived',
           archived_by = $2,
           archived_at = $3,
           updated_by = $2,
           updated_at = $3,
           version = version + 1
       where id = $1 and version = $4 and status = 'active'
       returning *, ''::text as qr_code`,
      [input.id, input.actorId, input.occurredAt, input.expectedVersion],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async countActiveItems(roomId: string): Promise<number> {
    const result = await this.source.query<{ count: number } & QueryResultRow>(
      `select count(*)::int as count from ${ITEMS}
       where room_id = $1 and status <> 'decommissioned' and archived_at is null`,
      [roomId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async insertRoomQr(input: InsertRoomQrRecord): Promise<void> {
    try {
      await this.source.query(
        `insert into ${QR_IDENTIFIERS}
           (id, original_value, canonical_key, format, target_kind, role,
            room_id, created_by)
         values ($1, $2, $2, 'generated_v1', 'room', 'primary', $3, $4)`,
        [input.id, input.value, input.roomId, input.actorId],
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
}

function buildingSelect(whereClause: string, orderClause = "") {
  return `
    select b.id, b.name, b.name_key, b.address, b.address_key, b.status,
           b.version, b.created_at, b.updated_at,
           coalesce(q.original_value, '') as qr_code,
           count(r.id)::int as room_count
    from ${BUILDINGS} b
    left join ${QR_IDENTIFIERS} q
      on q.building_id = b.id and q.status = 'active' and q.role = 'primary'
    left join ${ROOMS} r
      on r.building_id = b.id and r.status = 'active'
    ${whereClause}
    group by b.id, q.original_value
    ${orderClause}
  `;
}

function mapRequiredBuilding(
  row: BuildingRow | undefined,
): BuildingRecord {
  if (!row) throw new Error("Building write did not return a row.");
  return mapBuilding(row);
}

function mapBuilding(row: BuildingRow): BuildingRecord {
  return {
    id: row.id,
    name: row.name,
    nameKey: row.name_key,
    address: row.address,
    addressKey: row.address_key,
    qrCode: row.qr_code,
    roomCount: row.room_count,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function roomSelect(whereClause: string) {
  return `
    select r.id, r.building_id, r.designation, r.designation_key,
           r.floor_number, r.floor_label, r.status, r.version,
           r.created_at, r.updated_at,
           coalesce(q.original_value, '') as qr_code,
           r.primary_responsible_id,
           responsible.full_name as primary_responsible_name
    from ${ROOMS} r
    left join ${QR_IDENTIFIERS} q
      on q.room_id = r.id and q.status = 'active' and q.role = 'primary'
    left join ${USERS} responsible on responsible.id = r.primary_responsible_id
    ${whereClause}
    order by r.floor_number, r.designation_key, r.id
  `;
}

function mapRequiredRoom(row: RoomRow | undefined): RoomRecord {
  if (!row) throw new Error("Room write did not return a row.");
  return mapRoom(row);
}

function mapRoom(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    buildingId: row.building_id,
    designation: row.designation,
    designationKey: row.designation_key,
    floorNumber: row.floor_number,
    floorLabel: row.floor_label,
    primaryResponsibleId: row.primary_responsible_id,
    primaryResponsibleName: row.primary_responsible_name,
    qrCode: row.qr_code,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function postgresCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
