import "server-only";

import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@/lib/db/client";

/** The current registry, never a historical import batch. */
export async function getFixedAssetRegistryPage(
  query: { page: number; pageSize: number; search?: string; scope?: "active" | "all" },
  db: Pick<Pool, "query"> | PoolClient = getDatabasePool(),
) {
  const values: unknown[] = [];
  const where = query.scope === "all" ? ["true"] : ["i.payload->>'status' = 'Принято к учёту'"];
  if (query.search) {
    values.push(`%${query.search.replace(/[\\%_]/gu, character => `\\${character}`)}%`);
    where.push(`(i.payload->>'name' ilike $1 escape '\\' or i.payload->>'code' ilike $1 escape '\\'
      or i.payload->>'inventoryNumber' ilike $1 escape '\\' or i.payload->>'barcode' ilike $1 escape '\\'
      or i.payload->>'responsibleName' ilike $1 escape '\\' or i.payload->>'location' ilike $1 escape '\\'
      or i.external_id::text ilike $1 escape '\\')`);
  }
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  // Page and total use the same statement snapshot during concurrent imports.
  const result = await db.query(`with filtered as (
      select i.external_id,i.payload from "yu_inventory"."one_c_fixed_asset_inbox" i where ${where.join(" and ")}
    ), page as (
      select external_id,payload from filtered order by payload->>'name',external_id
      limit $${values.length - 1} offset $${values.length}
    ) select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb) as data`, values);
  return { data: result.rows[0].data, total: result.rows[0].total, page: query.page, pageSize: query.pageSize };
}
