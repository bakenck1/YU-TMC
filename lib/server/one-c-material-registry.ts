import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import type { MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";
import { extractExcelInventoryReferences, type ExcelSourceRow } from "@/lib/inventory-source-audit";

type Database = Pick<Pool, "query"> | PoolClient;

/** Reads one consistent source statement. Superseded legacy balances never enter live matching. */
export async function readMaterialRegistry(db: Database = getDatabasePool()) {
  const result = await db.query(`with latest as (
    select id,received_at,source_snapshot_at from "yu_inventory"."one_c_material_import_batches"
    order by received_at desc,id desc limit 1
  ) select b.id as batch_id,b.received_at,b.source_snapshot_at,i.row_key,i.payload_hash,i.payload
    from latest b left join "yu_inventory"."one_c_material_inbox" i on i.superseded_at is null
    order by i.row_key collate "C"`);
  const stored = result.rows.filter(row => row.row_key != null);
  const rows: ExcelSourceRow[] = [];
  for (const [index, row] of stored.entries()) {
    const material = row.payload as OneCMaterial;
    // Non-positive source balances stay in the registry/history, but do not assert current stock.
    if (!(Number(material.quantity) > 0)) continue;
    const references = [
      ...(material.inventoryNumber ? [{ inventoryNumber: material.inventoryNumber }] : []),
      ...extractExcelInventoryReferences(material.name).map(ref => ({ ...ref, numberIsUnmarked: true })),
    ];
    rows.push({
      sourceKind: "materials_api", sourceKey: String(row.row_key), rowNumber: index + 1,
      nomenclature: material.name, oneCCode: material.code, materialGuid: material.externalId,
      inventoryNumber: references[0]?.inventoryNumber ?? "", inventoryReferences: references,
      explicitInventoryNumber: material.inventoryNumber,
      barcode: material.barcode, endingBalance: material.quantity,
      accountCode: material.accountCode ?? null, warehouseName: material.warehouseName,
      warehouseCode: material.warehouseCode, responsibleName: material.responsibleName ?? null,
      responsibleCode: material.responsibleCode ?? null, unitPrice: material.unitPrice, unit: material.unit,
    });
  }
  const batch = result.rows[0];
  const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
  const metadata: MaterialRegistryMetadata = {
    kind: "materials_api", batchId: batch?.batch_id ? String(batch.batch_id) : null,
    receivedAt: iso(batch?.received_at), snapshotAt: iso(batch?.source_snapshot_at),
    sha256: createHash("sha256").update(JSON.stringify(stored.map(row => [row.row_key, row.payload_hash]))).digest("hex"),
    rowCount: stored.length, materialCount: new Set(stored.map(row => (row.payload as OneCMaterial).code)).size,
    positiveRows: rows.length, nonPositiveRows: stored.length - rows.length,
  };
  return { metadata, rows, records: stored.map(row => ({ key: String(row.row_key), material: row.payload as OneCMaterial })) };
}

export async function getMaterialRegistryMetadata(db: Database = getDatabasePool()) {
  return (await readMaterialRegistry(db)).metadata;
}

export async function getMaterialRegistryPage(query: { page: number; pageSize: number; search?: string }, db: Database = getDatabasePool()) {
  const values: unknown[] = [];
  const where = ["i.superseded_at is null"];
  if (query.search) {
    values.push(`%${query.search.replace(/[\\%_]/gu, character => `\\${character}`)}%`);
    where.push(`(i.material_code ilike $1 escape '\\' or i.material_external_id::text ilike $1 escape '\\'
      or i.payload->>'name' ilike $1 escape '\\' or i.payload->>'inventoryNumber' ilike $1 escape '\\'
      or i.payload->>'barcode' ilike $1 escape '\\' or i.payload->>'responsibleName' ilike $1 escape '\\'
      or i.payload->>'responsibleCode' ilike $1 escape '\\' or i.payload->>'accountCode' ilike $1 escape '\\')`);
  }
  // A single statement keeps page, total and metadata consistent during concurrent imports.
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  const result = await db.query(`with filtered as (
      select i.* from "yu_inventory"."one_c_material_inbox" i where ${where.join(" and ")}
    ), page as (
      select row_key,payload,source_snapshot_at,last_seen_at from filtered
      order by material_code,account_key,responsible_key,warehouse_key,row_key
      limit $${values.length - 1} offset $${values.length}
    ) select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb) as data`, values);
  return { data: result.rows[0].data, total: result.rows[0].total, page: query.page, pageSize: query.pageSize };
}
