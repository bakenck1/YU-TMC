import "server-only";

import type { QueryResultRow } from "pg";
import type {
  AppendInspectionAuditRecord,
  InspectionRecord,
  InspectionRoomRecord,
  ItemResultRecord,
  ItemSnapshotAtScan,
  InsertItemResultRecord,
  InsertItemResultRevisionRecord,
  InsertInspectionRecord,
  InsertInspectionRoomRecord,
  InventoryInspectionRepositories,
  InventoryInspectionRepository,
  RoomSnapshot,
} from "@/lib/application/ports/inventory-inspection-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const INSPECTIONS = '"yu_inventory"."inspections"';
const INSPECTION_ROOMS = '"yu_inventory"."inspection_rooms"';
const ROOMS = '"yu_inventory"."rooms"';
const BUILDINGS = '"yu_inventory"."buildings"';
const AUDIT = '"yu_inventory"."audit_records"';
const ITEMS = '"yu_inventory"."items"';
const RESPONSIBILITY = '"yu_inventory"."responsibility_periods"';
const ITEM_RESULTS = '"yu_inventory"."item_results"';
const ITEM_RESULT_REVISIONS = '"yu_inventory"."item_result_revisions"';

interface InspectionRow extends QueryResultRow {
  id: string;
  name: string;
  technician_id: string;
  status: InspectionRecord["status"];
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface InspectionRoomRow extends QueryResultRow {
  id: string;
  inspection_id: string;
  building_id: string;
  room_id: string;
  building_name: string;
  building_address: string;
  room_designation: string;
  floor_number: number;
  floor_label: string | null;
  added_at: Date;
  inspected_at: Date | null;
}

interface ItemSnapshotRow extends QueryResultRow {
  item_id: string;
  registry_room_id: string;
  responsible_user_id: string | null;
  item_name: string;
  inventory_number_kind: ItemSnapshotAtScan["inventoryNumberKind"];
  inventory_number: string;
  building_name: string;
  room_designation: string;
}

interface ItemResultRow extends QueryResultRow {
  id: string;
  inspection_id: string;
  inspection_room_id: string;
  item_id: string;
  registry_room_id_at_scan: string;
  responsible_id_at_scan: string | null;
  item_name_snapshot: string;
  inventory_number_snapshot: string;
  result: ItemResultRecord["result"];
  comment: string | null;
  revision_number: number;
  created_at: Date;
}

export function createPostgresInventoryInspectionRepositories(
  source: PostgresRepositorySource,
): InventoryInspectionRepositories {
  return {
    inspections: new PostgresInventoryInspectionRepository(source),
  };
}

class PostgresInventoryInspectionRepository
  implements InventoryInspectionRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async listInspections(technicianId?: string): Promise<InspectionRecord[]> {
    const result = await this.source.query<InspectionRow>(
      `select id, name, technician_id, status, version, created_at, updated_at
         from ${INSPECTIONS}
        ${technicianId ? "where technician_id = $1" : ""}
        order by updated_at desc, id
        `,
      technicianId ? [technicianId] : [],
    );
    return result.rows.map(mapInspection);
  }

  async findInspection(id: string): Promise<InspectionRecord | null> {
    const result = await this.source.query<InspectionRow>(
      `select id, name, technician_id, status, version, created_at, updated_at
         from ${INSPECTIONS}
        where id = $1`,
      [id],
    );
    return result.rows[0] ? mapInspection(result.rows[0]) : null;
  }

  async listRooms(inspectionId: string): Promise<InspectionRoomRecord[]> {
    const result = await this.source.query<InspectionRoomRow>(
      `select id, inspection_id, building_id, room_id,
              building_name_snapshot as building_name,
              building_address_snapshot as building_address,
              room_designation_snapshot as room_designation,
              room_floor_number_snapshot as floor_number,
              room_floor_label_snapshot as floor_label,
              added_at, inspected_at
         from ${INSPECTION_ROOMS}
        where inspection_id = $1
        order by added_at, id`,
      [inspectionId],
    );
    return result.rows.map(mapRoom);
  }

  async findInspectionRoom(
    inspectionId: string,
    inspectionRoomId: string,
  ): Promise<InspectionRoomRecord | null> {
    const result = await this.source.query<InspectionRoomRow>(
      `select id, inspection_id, building_id, room_id,
              building_name_snapshot as building_name,
              building_address_snapshot as building_address,
              room_designation_snapshot as room_designation,
              room_floor_number_snapshot as floor_number,
              room_floor_label_snapshot as floor_label,
              added_at, inspected_at
         from ${INSPECTION_ROOMS}
        where id = $1 and inspection_id = $2`,
      [inspectionRoomId, inspectionId],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : null;
  }

  async findItemSnapshot(itemId: string): Promise<ItemSnapshotAtScan | null> {
    const result = await this.source.query<ItemSnapshotRow>(
      `select i.id as item_id, i.room_id as registry_room_id,
              rp.responsible_user_id, i.name as item_name,
              i.inventory_number_kind, i.inventory_number,
              b.name as building_name, r.designation as room_designation
         from ${ITEMS} i
         join ${ROOMS} r on r.id = i.room_id
         join ${BUILDINGS} b on b.id = r.building_id
         left join lateral (
           select responsible_user_id
             from ${RESPONSIBILITY}
            where item_id = i.id and ended_at is null
            limit 1
         ) rp on true
        where i.id = $1`,
      [itemId],
    );
    const row = result.rows[0];
    return row
      ? {
          itemId: row.item_id,
          registryRoomId: row.registry_room_id,
          responsibleUserId: row.responsible_user_id,
          itemName: row.item_name,
          inventoryNumberKind: row.inventory_number_kind,
          inventoryNumber: row.inventory_number,
          buildingName: row.building_name,
          roomDesignation: row.room_designation,
        }
      : null;
  }

  async findItemResult(
    inspectionId: string,
    itemId: string,
  ): Promise<ItemResultRecord | null> {
    const result = await this.source.query<ItemResultRow>(itemResultSelect("where ir.inspection_id = $1 and ir.item_id = $2"), [
      inspectionId,
      itemId,
    ]);
    return result.rows[0] ? mapItemResult(result.rows[0]) : null;
  }

  async listItemResults(inspectionId: string): Promise<ItemResultRecord[]> {
    const result = await this.source.query<ItemResultRow>(
      itemResultSelect("where ir.inspection_id = $1"),
      [inspectionId],
    );
    return result.rows.map(mapItemResult);
  }

  async findActiveRoomSnapshot(
    buildingId: string,
    roomId: string,
  ): Promise<RoomSnapshot | null> {
    const result = await this.source.query<{
      id: string;
      building_id: string;
      building_name: string;
      building_address: string;
      designation: string;
      floor_number: number;
      floor_label: string | null;
    }>(
      `select r.id, b.id as building_id, b.name as building_name,
              b.address as building_address, r.designation,
              r.floor_number, r.floor_label
         from ${ROOMS} r
         join ${BUILDINGS} b on b.id = r.building_id
        where r.id = $1 and r.building_id = $2
          and r.status = 'active' and b.status = 'active'`,
      [roomId, buildingId],
    );
    const row = result.rows[0];
    return row
      ? {
          buildingId: row.building_id,
          roomId: row.id,
          buildingName: row.building_name,
          buildingAddress: row.building_address,
          roomDesignation: row.designation,
          floorNumber: Number(row.floor_number),
          floorLabel: row.floor_label,
        }
      : null;
  }

  async insertInspection(
    input: InsertInspectionRecord,
  ): Promise<InspectionRecord> {
    const result = await this.source.query<InspectionRow>(
      `insert into ${INSPECTIONS}
         (id, name, technician_id, created_by, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $5)
       returning id, name, technician_id, status, version, created_at, updated_at`,
      [
        input.id,
        input.name,
        input.technicianId,
        input.createdBy,
        input.createdAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("inspection_insert_failed");
    return mapInspection(row);
  }

  async insertInspectionRoom(
    input: InsertInspectionRoomRecord,
  ): Promise<InspectionRoomRecord> {
    const result = await this.source.query<InspectionRoomRow>(
      `insert into ${INSPECTION_ROOMS}
         (id, inspection_id, building_id, room_id,
          building_name_snapshot, building_address_snapshot,
          room_designation_snapshot, room_floor_number_snapshot,
          room_floor_label_snapshot, added_by, added_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id, inspection_id, building_id, room_id,
          building_name_snapshot as building_name,
          building_address_snapshot as building_address,
          room_designation_snapshot as room_designation,
          room_floor_number_snapshot as floor_number,
          room_floor_label_snapshot as floor_label,
          added_at, inspected_at`,
      [
        input.id,
        input.inspectionId,
        input.snapshot.buildingId,
        input.snapshot.roomId,
        input.snapshot.buildingName,
        input.snapshot.buildingAddress,
        input.snapshot.roomDesignation,
        input.snapshot.floorNumber,
        input.snapshot.floorLabel,
        input.addedBy,
        input.addedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("inspection_room_insert_failed");
    return mapRoom(row);
  }

  async insertItemResult(input: InsertItemResultRecord): Promise<ItemResultRecord> {
    const recipientKind = input.snapshot.responsibleUserId ? "user" : "admin_queue";
    const result = await this.source.query<{
      id: string;
      inspection_id: string;
      inspection_room_id: string;
      item_id: string;
      registry_room_id_at_scan: string;
      responsible_id_at_scan: string | null;
      item_name_snapshot: string;
      inventory_number_snapshot: string;
      created_at: Date;
    }>(
      `insert into ${ITEM_RESULTS}
         (id, inspection_id, inspection_room_id, item_id, registry_room_id_at_scan,
          responsible_id_at_scan, decision_recipient_kind_at_scan,
          item_name_snapshot, inventory_number_kind_snapshot, inventory_number_snapshot,
          building_name_snapshot, room_designation_snapshot, created_by, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       returning id, inspection_id, inspection_room_id, item_id,
                 registry_room_id_at_scan, responsible_id_at_scan,
                 item_name_snapshot, inventory_number_snapshot, created_at`,
      [
        input.id,
        input.inspectionId,
        input.inspectionRoomId,
        input.snapshot.itemId,
        input.snapshot.registryRoomId,
        input.snapshot.responsibleUserId,
        recipientKind,
        input.snapshot.itemName,
        input.snapshot.inventoryNumberKind,
        input.snapshot.inventoryNumber,
        input.snapshot.buildingName,
        input.snapshot.roomDesignation,
        input.createdBy,
        input.createdAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("item_result_insert_failed");
    return {
      id: row.id,
      inspectionId: row.inspection_id,
      inspectionRoomId: row.inspection_room_id,
      itemId: row.item_id,
      registryRoomIdAtScan: row.registry_room_id_at_scan,
      responsibleIdAtScan: row.responsible_id_at_scan,
      itemNameSnapshot: row.item_name_snapshot,
      inventoryNumberSnapshot: row.inventory_number_snapshot,
      result: "undetermined",
      comment: null,
      revisionNumber: 0,
      createdAt: new Date(row.created_at),
    };
  }

  async insertItemResultRevision(input: InsertItemResultRevisionRecord): Promise<void> {
    await this.source.query(
      `insert into ${ITEM_RESULT_REVISIONS}
         (result_id, revision_number, result, inspection_room_id, observed_room_id,
          comment, created_by, created_at)
       values ($1, 1, $2, $3, $4, $5, $6, $7)`,
      [
        input.resultId,
        input.result,
        input.inspectionRoomId,
        input.observedRoomId,
        input.comment,
        input.createdBy,
        input.createdAt,
      ],
    );
  }

  async markInspectionRoomInspected(
    inspectionRoomId: string,
    inspectedBy: string,
    inspectedAt: Date,
  ): Promise<void> {
    await this.source.query(
      `update ${INSPECTION_ROOMS}
          set inspected_at = coalesce(inspected_at, $2),
              inspected_by = coalesce(inspected_by, $1)
        where id = $3`,
      [inspectedBy, inspectedAt, inspectionRoomId],
    );
  }

  async appendAudit(input: AppendInspectionAuditRecord): Promise<void> {
    await this.source.query(
      `insert into ${AUDIT}
         (id, actor_id, actor_role_snapshot, subject_kind, subject_id,
          subject_revision, action, before_values, after_values, occurred_at)
       values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9)`,
      [
        input.id,
        input.actorId,
        input.actorRole,
        input.subjectKind,
        input.subjectId,
        input.action,
        input.beforeValues,
        input.afterValues,
        input.occurredAt,
      ],
    );
  }
}

function mapInspection(row: InspectionRow): InspectionRecord {
  return {
    id: row.id,
    name: row.name,
    technicianId: row.technician_id,
    status: row.status,
    version: Number(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRoom(row: InspectionRoomRow): InspectionRoomRecord {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    buildingId: row.building_id,
    roomId: row.room_id,
    buildingName: row.building_name,
    buildingAddress: row.building_address,
    roomDesignation: row.room_designation,
    floorNumber: Number(row.floor_number),
    floorLabel: row.floor_label,
    addedAt: new Date(row.added_at),
    inspectedAt: row.inspected_at ? new Date(row.inspected_at) : null,
  };
}

function itemResultSelect(where: string) {
  return `select ir.id, ir.inspection_id, ir.inspection_room_id, ir.item_id,
                 ir.registry_room_id_at_scan, ir.responsible_id_at_scan,
                 ir.item_name_snapshot, ir.inventory_number_snapshot,
                 revision.result, revision.comment, revision.revision_number,
                 ir.created_at
            from ${ITEM_RESULTS} ir
            join lateral (
              select result, comment, revision_number
                from ${ITEM_RESULT_REVISIONS}
               where result_id = ir.id
               order by revision_number desc
               limit 1
            ) revision on true
            ${where}
           order by ir.created_at desc, ir.id`;
}

function mapItemResult(row: ItemResultRow): ItemResultRecord {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    inspectionRoomId: row.inspection_room_id,
    itemId: row.item_id,
    registryRoomIdAtScan: row.registry_room_id_at_scan,
    responsibleIdAtScan: row.responsible_id_at_scan,
    itemNameSnapshot: row.item_name_snapshot,
    inventoryNumberSnapshot: row.inventory_number_snapshot,
    result: row.result,
    comment: row.comment,
    revisionNumber: Number(row.revision_number),
    createdAt: new Date(row.created_at),
  };
}
