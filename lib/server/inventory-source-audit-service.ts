import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApplicationError } from "@/lib/domain/application-error";
import { buildInventorySourceAudit, INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION, type AuditItem, type AuditOneCRow, type AuditMatch } from "@/lib/inventory-source-audit";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { parseStoredMaterialSnapshot } from "@/lib/server/material-snapshot";

type Db = Pick<Pool, "query"> | PoolClient;
type Raw = Record<string, unknown>;
const SCHEMA = '"yu_inventory"';

export async function createInventorySourceAudit(client: PoolClient, batchId: string, batchVersion: number, candidateRows: Raw[], linkRows: Raw[]) {
  const snapshot = await client.query(`select s.id,s.sha256,s.byte_size,s.source_file from ${SCHEMA}."material_snapshot_selection" chosen join ${SCHEMA}."material_snapshots" s on s.id=chosen.snapshot_id where chosen.id=1`);
  if (!snapshot.rows[0]) throw new ApplicationError("unavailable", "material_snapshot_not_imported");
  const parsedSnapshot = parseStoredMaterialSnapshot(snapshot.rows[0]);
  const registry = await client.query(`select external_id,payload_hash,payload from ${SCHEMA}."one_c_fixed_asset_inbox" order by external_id`);
  const batchRows = await client.query(`select external_id,payload_hash,payload,matched_item_id,review_state from ${SCHEMA}."one_c_import_batch_rows" where batch_id=$1 order by external_id`, [batchId]);
  if (!registry.rows.length && !batchRows.rows.length) throw new ApplicationError("unavailable", "one_c_registry_empty");
  const oneCRegistrySha256 = createHash("sha256").update(registry.rows.map((row) => `${row.external_id}:${row.payload_hash}`).join("\n")).digest("hex");
  const items: AuditItem[] = candidateRows.filter((row) => row.archived_at == null).map((row) => ({ id: String(row.id), name: String(row.name), inventoryNumber: String(row.inventory_number), inventoryNumberKind: String(row.inventory_number_kind), oneCCode: nullable(row.one_c_code), version: Number(row.version), officialBarcodes: strings(row.official_barcodes), localBarcodes: strings(row.local_barcodes), sourceCodes: linkRows.filter((link) => link.item_id === row.id).map((link) => String(link.source_code ?? "")).filter(Boolean) }));
  const assets: AuditOneCRow[] = registry.rows.map((row) => ({ externalId: String(row.external_id), asset: row.payload as OneCFixedAsset, origins: ["current_registry"] }));
  const registryById = new Map(registry.rows.map((row, index) => [String(row.external_id), { row, index }]));
  for (const row of batchRows.rows) {
    const current = registryById.get(String(row.external_id));
    // A conflict or publication block does not erase evidence that the 1C row exists.
    // Review state remains visible and publication retains its separate checks.
    const batchMatchedItemId = nullable(row.matched_item_id);
    if (current && current.row.payload_hash === row.payload_hash) {
      assets[current.index].origins = ["selected_batch", "current_registry"];
      assets[current.index].batchMatchedItemId = batchMatchedItemId;
      assets[current.index].reviewState = nullable(row.review_state);
    } else {
      assets.push({ externalId: String(row.external_id), asset: row.payload as OneCFixedAsset, origins: ["selected_batch"], batchMatchedItemId, reviewState: nullable(row.review_state) });
    }
  }
  const links = linkRows.map((row) => ({ externalId: String(row.external_id), itemId: String(row.item_id) }));
  const { rows, counts } = buildInventorySourceAudit(items, assets, parsedSnapshot.accepted, links);
  if (counts.total !== counts.oneCOnly + counts.excelOnly + counts.both + counts.missing) throw new Error("inventory_audit_count_mismatch");
  const byItemId = new Map(rows.map((row) => [row.itemId, row]));
  for (const batchRow of batchRows.rows) {
    const matchedItemId = nullable(batchRow.matched_item_id);
    if (!matchedItemId || !byItemId.has(matchedItemId)) continue;
    if (!byItemId.get(matchedItemId)!.oneC.some((match) => match.externalId === batchRow.external_id && match.origins.includes("selected_batch"))) {
      throw new Error("inventory_audit_batch_match_missing");
    }
  }
  const id = randomUUID();
  await client.query(`insert into ${SCHEMA}."inventory_source_audit_runs"(id,batch_id,batch_version,snapshot_id,one_c_registry_sha256,counts) values($1,$2,$3,$4,$5,$6::jsonb)`, [id, batchId, batchVersion, snapshot.rows[0].id, oneCRegistrySha256, JSON.stringify(counts)]);
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500).map((row) => ({ item_id: row.itemId, item_name: row.itemName, site_number: row.siteNumber, site_barcodes: row.siteBarcodes, number_kind: row.numberKind, item_version: row.itemVersion, result: row.result, source: row.source, one_c_matches: row.oneC, excel_matches: row.excel }));
    await client.query(`insert into ${SCHEMA}."inventory_source_audit_rows"(run_id,item_id,item_name,site_number,site_barcodes,number_kind,item_version,result,source,one_c_matches,excel_matches)
      select $1,x.item_id,x.item_name,x.site_number,x.site_barcodes,x.number_kind,x.item_version,x.result,x.source,x.one_c_matches,x.excel_matches
      from jsonb_to_recordset($2::jsonb) as x(item_id uuid,item_name text,site_number text,site_barcodes jsonb,number_kind text,item_version integer,result text,source text,one_c_matches jsonb,excel_matches jsonb)`, [id, JSON.stringify(chunk)]);
  }
  return { id, counts, excelSha256: String(snapshot.rows[0].sha256), oneCRegistrySha256, batchVersion, snapshotId: String(snapshot.rows[0].id), algorithmVersion: INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION, excelAcceptedCount: parsedSnapshot.accepted.length, excelSkippedCount: parsedSnapshot.skipped };
}

export async function getInventorySourceAuditPage(db: Db, batchId: string, query: { page: number; pageSize: number; search?: string; result?: string; source?: string }) {
  const run = await latestRun(db, batchId);
  const values: unknown[] = [run.id];
  const conditions = ["run_id=$1"];
  if (query.search) {
    values.push(`%${query.search.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`);
    conditions.push(`(item_name ilike $${values.length} escape '\\' or site_number ilike $${values.length} escape '\\' or site_barcodes::text ilike $${values.length} escape '\\' or item_id::text ilike $${values.length} escape '\\' or one_c_matches::text ilike $${values.length} escape '\\' or excel_matches::text ilike $${values.length} escape '\\')`);
  }
  if (query.result) conditions.push(`result=$${values.push(query.result)}`);
  if (query.source) conditions.push(`source=$${values.push(query.source)}`);
  const count = await db.query(`select count(*)::int as total from ${SCHEMA}."inventory_source_audit_rows" where ${conditions.join(" and ")}`, values);
  values.push(query.pageSize, (query.page - 1) * query.pageSize);
  const page = await db.query(`select * from ${SCHEMA}."inventory_source_audit_rows" where ${conditions.join(" and ")} order by item_name,item_id limit $${values.length - 1} offset $${values.length}`, values);
  return { run, data: page.rows.map(mapAuditRow), page: query.page, pageSize: query.pageSize, total: Number(count.rows[0].total) };
}

export async function exportInventorySourceAudit(db: Db, batchId: string) {
  const run = await latestRun(db, batchId);
  const rows = await db.query(`select * from ${SCHEMA}."inventory_source_audit_rows" where run_id=$1 order by item_name,item_id`, [run.id]);
  return { run, rows: rows.rows.map(mapAuditRow) };
}

export async function getInventorySourceExcelRow(db: Db, batchId: string, rowNumber: number) {
  const run = await latestRun(db, batchId);
  // Read the exact evidence saved by this run, including rows omitted by an older parser.
  const result = await db.query(`select (match->>'rowNumber')::int as row_number,match->>'nomenclature' as nomenclature,
    match->>'inventoryNumber' as inventory_number,match->>'sourceInventoryNumber' as source_inventory_number,match->'inventoryReferences' as inventory_references,match->>'endingBalance' as ending_balance
    from ${SCHEMA}."inventory_source_audit_rows" r cross join lateral jsonb_array_elements(r.excel_matches) match
    where r.run_id=$1 and match->>'rowNumber'=$2 order by r.item_id limit 1`, [run.id, String(rowNumber)]);
  if (!result.rows[0]) throw new ApplicationError("not_found", "material_snapshot_row_not_found");
  return { file: run.filename, sha256: run.sha256, ...result.rows[0] };
}

async function latestRun(db: Db, batchId: string) {
  const run = await db.query(`select a.*,s.filename,s.sha256,s.accepted_count,s.skipped_count,b.source_sha256 as batch_sha256,
    case when b.summary->'inventoryAudit'->>'id'=a.id::text then b.summary->'inventoryAudit'->>'algorithmVersion' else null end as algorithm_version,
    case when b.summary->'inventoryAudit'->>'id'=a.id::text then (b.summary->'inventoryAudit'->>'excelAcceptedCount')::int else null end as excel_accepted_count,
    case when b.summary->'inventoryAudit'->>'id'=a.id::text then (b.summary->'inventoryAudit'->>'excelSkippedCount')::int else null end as excel_skipped_count
    from ${SCHEMA}."inventory_source_audit_runs" a join ${SCHEMA}."material_snapshots" s on s.id=a.snapshot_id
    join ${SCHEMA}."one_c_import_batches" b on b.id=a.batch_id
    where a.batch_id=$1 order by a.run_at desc,a.id desc limit 1`, [batchId]);
  if (!run.rows[0]) throw new ApplicationError("not_found", "inventory_source_audit_not_found");
  return run.rows[0] as Raw;
}

function mapAuditRow(row: Raw): AuditMatch {
  return { itemId: String(row.item_id), itemName: String(row.item_name), siteNumber: String(row.site_number), siteBarcodes: row.site_barcodes as AuditMatch["siteBarcodes"], numberKind: String(row.number_kind), itemVersion: Number(row.item_version), result: row.result as AuditMatch["result"], source: row.source as AuditMatch["source"], oneC: row.one_c_matches as AuditMatch["oneC"], excel: row.excel_matches as AuditMatch["excel"] };
}
function nullable(value: unknown) { return typeof value === "string" && value.trim() ? value : null; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
