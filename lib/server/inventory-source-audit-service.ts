import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ApplicationError } from "@/lib/domain/application-error";
import { buildInventorySourceAudit, INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION, type AuditItem, type AuditOneCRow, type AuditMatch } from "@/lib/inventory-source-audit";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import type { InventoryAuditInventoryState } from "@/lib/contracts/inventory-source-audit";
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
  return { id, counts, excelSha256: String(snapshot.rows[0].sha256), oneCRegistrySha256, oneCLinksSha256: linksSha256(linkRows), batchVersion, snapshotId: String(snapshot.rows[0].id), algorithmVersion: INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION, excelAcceptedCount: parsedSnapshot.accepted.length, excelSkippedCount: parsedSnapshot.skipped };
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
    case when b.summary->'inventoryAudit'->>'id'=a.id::text then (b.summary->'inventoryAudit'->>'excelSkippedCount')::int else null end as excel_skipped_count,
    case when b.summary->'inventoryAudit'->>'id'=a.id::text then b.summary->'inventoryAudit'->>'oneCLinksSha256' else null end as one_c_links_sha256
    from ${SCHEMA}."inventory_source_audit_runs" a join ${SCHEMA}."material_snapshots" s on s.id=a.snapshot_id
    join ${SCHEMA}."one_c_import_batches" b on b.id=a.batch_id
    where a.batch_id=$1 order by a.run_at desc,a.id desc limit 1`, [batchId]);
  if (!run.rows[0]) throw new ApplicationError("not_found", "inventory_source_audit_not_found");
  // Saved totals describe the dry-run, while these live counts reveal additions,
  // removals and edits even if the total number of cards did not change.
  const current = await db.query(`with live_barcodes as (
      select item_id,jsonb_build_object('kind','official','value',original_value) as barcode
        from ${SCHEMA}."barcode_registry" where kind='official'
      union all
      select item_id,jsonb_build_object('kind','local','value',barcode_value)
        from ${SCHEMA}."local_item_groups" where status='active'
    ), live as (
      select i.id,i.name,i.inventory_number,i.inventory_number_kind,i.status,i.quantity,i.version,
        coalesce(br.barcodes,'[]'::jsonb) as barcodes
      from ${SCHEMA}."items" i
      left join (select item_id,jsonb_agg(barcode) as barcodes from live_barcodes group by item_id) br on br.item_id=i.id
      where i.archived_at is null
    ) select count(*)::int as current_total,
      count(*) filter(where l.status='active')::int as current_active,
      coalesce(sum(l.quantity),0)::float8 as current_quantity,
      coalesce(sum(l.quantity) filter(where l.status='active'),0)::float8 as current_active_quantity,
      count(*) filter(where s.item_id is null)::int as added,
      count(*) filter(where s.item_id is not null and (s.item_version<>l.version or s.item_name<>l.name
        or s.site_number<>l.inventory_number or s.number_kind<>l.inventory_number_kind::text
        or not(coalesce(s.site_barcodes,'[]'::jsonb) @> l.barcodes and l.barcodes @> coalesce(s.site_barcodes,'[]'::jsonb))))::int as changed,
      (select count(*)::int from ${SCHEMA}."inventory_source_audit_rows" saved
        where saved.run_id=$1 and not exists(select 1 from live where live.id=saved.item_id)) as removed,
      (select coalesce(jsonb_agg(jsonb_build_object('external_id',external_id,'item_id',item_id,'source_code',source_code)),'[]'::jsonb)
        from ${SCHEMA}."item_one_c_links") as live_links
    from live l left join ${SCHEMA}."inventory_source_audit_rows" s on s.run_id=$1 and s.item_id=l.id`, [run.rows[0].id]);
  const state = current.rows[0];
  const linksChanged = typeof run.rows[0].one_c_links_sha256 === "string"
    && run.rows[0].one_c_links_sha256 !== linksSha256(state.live_links as Raw[]);
  const inventory: InventoryAuditInventoryState = {
    currentTotal: Number(state.current_total), currentActive: Number(state.current_active),
    currentQuantity: Number(state.current_quantity), currentActiveQuantity: Number(state.current_active_quantity),
    added: Number(state.added), removed: Number(state.removed), changed: Number(state.changed),
    linksChanged, stale: Number(state.added) + Number(state.removed) + Number(state.changed) > 0 || linksChanged,
  };
  return { ...run.rows[0], inventory } as Raw & { inventory: InventoryAuditInventoryState };
}

function mapAuditRow(row: Raw): AuditMatch {
  return { itemId: String(row.item_id), itemName: String(row.item_name), siteNumber: String(row.site_number), siteBarcodes: row.site_barcodes as AuditMatch["siteBarcodes"], numberKind: String(row.number_kind), itemVersion: Number(row.item_version), result: row.result as AuditMatch["result"], source: row.source as AuditMatch["source"], oneC: row.one_c_matches as AuditMatch["oneC"], excel: row.excel_matches as AuditMatch["excel"] };
}
function nullable(value: unknown) { return typeof value === "string" && value.trim() ? value : null; }
function linksSha256(rows: Raw[]) {
  const values = rows.map((row) => [String(row.external_id), String(row.item_id), nullable(row.source_code)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
