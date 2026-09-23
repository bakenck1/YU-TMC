import "server-only";

import type { Pool } from "pg";

import { CAMPUS_BUILDING_PRESETS } from "@/lib/campus-directory";
import type {
  DormitoryAsset,
  DormitoryAssetCondition,
  DormitoryAssetRepository,
  DormitoryAssetStatus,
} from "@/lib/contracts/dormitory-api";
import { getDatabasePool } from "@/lib/db/client";

export const DORMITORY_NAMES = CAMPUS_BUILDING_PRESETS
  .filter((building) => building.id.startsWith("dormitory-") || building.id.startsWith("off-campus-dormitory-"))
  .flatMap((building) => [building.name, ...(building.legacyNames ?? [])]);

interface DormitoryAssetRow {
  id: string;
  code: string;
  inventory_number: string;
  name: string;
  category: string;
  acceptance_date: string | null;
  responsible_person: string | null;
  department: string | null;
  building_id: string;
  building_name: string;
  room_id: string;
  room: string;
  floor_number: number;
  initial_cost: string | number;
  residual_cost: string | number | null;
  status: DormitoryAssetStatus;
  condition: DormitoryAssetCondition;
  accounting_status: string | null;
  updated_at: Date;
}

export function createPostgresDormitoryAssetRepository(
  pool: Pick<Pool, "query"> = getDatabasePool(),
): DormitoryAssetRepository {
  return {
    async listItems(page) {
      const result = await pool.query<DormitoryAssetRow>(`
        with projected as (
        select i.id,
               coalesce(nullif(link.source_code, ''), nullif(i.one_c_code, ''), i.inventory_number) as code,
               i.inventory_number,
               i.name,
               coalesce(nullif(batch_row.payload->>'category', ''), i.item_type) as category,
               left(nullif(batch_row.payload->>'acceptedAt', ''), 10) as acceptance_date,
               coalesce(responsible.full_name, nullif(link.source_responsible_name, '')) as responsible_person,
               nullif(link.source_department, '') as department,
               b.id as building_id, b.name as building_name,
               r.id as room_id, r.designation as room, r.floor_number,
               case
                 when coalesce(batch_row.payload->>'initialCost', '') ~ '^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,2})?$'
                   then (batch_row.payload->>'initialCost')::numeric
                 else i.unit_price
               end as initial_cost,
               link.accounting_residual_value as residual_cost,
               case
                 when i.status::text in ('decommissioned', 'decommissioned_in_use') then 'written_off'
                 when i.status::text = 'maintenance' then 'maintenance'
                 else 'active'
               end as status,
               i.condition::text as condition,
               link.accounting_status,
               date_trunc('milliseconds', greatest(
                 i.updated_at,
                 coalesce(link.source_updated_at, '-infinity'::timestamptz),
                 coalesce(link.linked_at, '-infinity'::timestamptz)
               )) as updated_at
          from "yu_inventory"."items" i
          join "yu_inventory"."rooms" r on r.id = i.room_id
          join "yu_inventory"."buildings" b on b.id = r.building_id
          left join "yu_inventory"."item_one_c_links" link on link.item_id = i.id
          left join "yu_inventory"."one_c_import_batch_rows" batch_row
            on batch_row.batch_id = link.last_batch_id and batch_row.external_id = link.external_id
          left join lateral (
            select u.full_name
              from "yu_inventory"."responsibility_periods" period
              join "yu_inventory"."users" u on u.id = period.responsible_user_id
             where period.item_id = i.id and period.ended_at is null
             order by period.started_at desc, period.id
             limit 1
          ) responsible on true
         where b.name = any($1::text[])
        )
        select * from projected
         where ($2::timestamptz is null
           or updated_at < $2
           or (updated_at = $2 and id > $3::uuid))
         order by updated_at desc, id
         limit $4`,
        [DORMITORY_NAMES, page.after?.updatedAt ?? null, page.after?.id ?? null, page.limit],
      );
      return result.rows.map(mapAsset);
    },
  };
}

function mapAsset(row: DormitoryAssetRow): DormitoryAsset {
  return {
    id: row.id,
    code: row.code,
    inventoryNumber: row.inventory_number,
    name: row.name,
    category: row.category,
    acceptanceDate: row.acceptance_date,
    responsiblePerson: row.responsible_person,
    department: row.department,
    location: {
      buildingId: row.building_id,
      buildingName: row.building_name,
      roomId: row.room_id,
      room: row.room,
      floorNumber: Number(row.floor_number),
    },
    initialCost: Number(row.initial_cost),
    residualCost: row.residual_cost === null ? null : Number(row.residual_cost),
    currency: "KZT",
    status: row.status,
    condition: row.condition,
    accountingStatus: row.accounting_status,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
