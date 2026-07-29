import "server-only";

import type { QueryResultRow } from "pg";
import type {
  QrResolutionRecord,
  QrResolutionRepositories,
  QrResolutionRepository,
} from "@/lib/application/ports/qr-resolution-repositories";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const QR = '"yu_inventory"."qr_identifiers"';
const BUILDINGS = '"yu_inventory"."buildings"';
const ROOMS = '"yu_inventory"."rooms"';
const ITEMS = '"yu_inventory"."items"';
const RESPONSIBILITY = '"yu_inventory"."responsibility_periods"';
const USERS = '"yu_inventory"."users"';

interface QrRow extends QueryResultRow {
  canonical_key: string;
  format: QrResolutionRecord["format"];
  qr_status: QrResolutionRecord["qrStatus"];
  target_kind: QrResolutionRecord["targetKind"];
  target_id: string;
  target_status: QrResolutionRecord["targetStatus"];
  title: string;
  building_name: string | null;
  room_designation: string | null;
  inventory_number: string | null;
  responsible_name: string | null;
}

export function createPostgresQrResolutionRepositories(
  source: PostgresRepositorySource,
): QrResolutionRepositories {
  return { qr: new PostgresQrResolutionRepository(source) };
}

class PostgresQrResolutionRepository implements QrResolutionRepository {
  constructor(private readonly source: PostgresRepositorySource) {}

  async findByCanonicalKey(
    canonicalKey: string,
  ): Promise<QrResolutionRecord | null> {
    const result = await this.source.query<QrRow>(
      `select q.canonical_key, q.format, q.status as qr_status,
              q.target_kind,
              coalesce(q.building_id, q.room_id, q.item_id) as target_id,
              coalesce(b.status::text, r.status::text, i.status::text) as target_status,
              coalesce(b.name, r.designation, i.name) as title,
              b.name as building_name,
              r.designation as room_designation,
              i.inventory_number,
              u.full_name as responsible_name
         from ${QR} q
         left join ${BUILDINGS} b on b.id = q.building_id
         left join ${ROOMS} r on r.id = q.room_id
         left join ${ITEMS} i on i.id = q.item_id
         left join lateral (
           select responsible_user_id
             from ${RESPONSIBILITY}
            where item_id = i.id and ended_at is null
            order by started_at desc
            limit 1
         ) rp on true
         left join ${USERS} u on u.id = rp.responsible_user_id
        where q.canonical_key = $1
        limit 1`,
      [canonicalKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      canonicalKey: row.canonical_key,
      format: row.format,
      qrStatus: row.qr_status,
      targetKind: row.target_kind,
      targetId: row.target_id,
      targetStatus: row.target_status,
      title: row.title,
      buildingName: row.building_name,
      roomDesignation: row.room_designation,
      inventoryNumber: row.inventory_number,
      responsibleName: row.responsible_name,
    };
  }
}
