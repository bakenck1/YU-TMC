import "server-only";
import type { Pool } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { buildInventorySourceAudit, type AuditItem } from "@/lib/inventory-source-audit";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { summarizeOneCAudit, type OneCAnalytics } from "@/lib/one-c-analytics";
import { readMaterialRegistry } from "@/lib/server/one-c-material-registry";

export async function getOneCAnalytics(pool: Pick<Pool, "connect"> = getDatabasePool()) {
  const { analytics, materials } = await getOneCAnalyticsSnapshot(pool);
  return { analytics, materials };
}

/** Export and dashboard share the same matching and consistent database snapshot. */
export async function getOneCAnalyticsSnapshot(pool: Pick<Pool, "connect"> = getDatabasePool()) {
  const client = await pool.connect();
  try {
    // Counts and matching describe the same database state, even during an import.
    await client.query("begin isolation level repeatable read read only");
    const assets = await client.query(`select external_id,payload,last_seen_at,received_at from yu_inventory.one_c_fixed_asset_inbox order by external_id`);
    const materials = await readMaterialRegistry(client);
    const items = await client.query(`select i.id,i.name,i.inventory_number,i.inventory_number_kind,i.one_c_code,i.version,i.status,i.quantity,
      coalesce((select array_agg(original_value) from yu_inventory.barcode_registry where item_id=i.id and kind='official'),'{}') as official_barcodes,
      coalesce((select array_agg(barcode_value) from yu_inventory.local_item_groups where item_id=i.id and status='active'),'{}') as local_barcodes
      from yu_inventory.items i where archived_at is null order by i.id`);
    const links = await client.query(`select external_id,item_id,source_code from yu_inventory.item_one_c_links`);
    const clock = await client.query("select transaction_timestamp() as calculated_at");
    await client.query("commit");

    const codes = new Map<string, string[]>();
    for (const link of links.rows) if (link.source_code) codes.set(link.item_id, [...(codes.get(link.item_id) ?? []), link.source_code]);
    const auditItems: AuditItem[] = items.rows.map(row => ({
      id: row.id, name: row.name, inventoryNumber: row.inventory_number, inventoryNumberKind: row.inventory_number_kind,
      oneCCode: row.one_c_code, version: row.version, officialBarcodes: row.official_barcodes,
      localBarcodes: row.local_barcodes, sourceCodes: codes.get(row.id) ?? [],
    }));
    const sourceAssets = assets.rows.map(row => ({ externalId: String(row.external_id), asset: row.payload as OneCFixedAsset, origins: ["current_registry" as const] }));
    const audit = buildInventorySourceAudit(auditItems, sourceAssets, materials.rows, links.rows.map(row => ({ externalId: row.external_id, itemId: row.item_id })), { descriptionBarcodes: true });
    const active = sourceAssets.filter(row => row.asset.status === "Принято к учёту").length;
    const retired = sourceAssets.filter(row => row.asset.status === "Снято с учёта").length;
    const dates = assets.rows.map(row => new Date(row.last_seen_at ?? row.received_at).valueOf()).filter(Number.isFinite);
    const analytics: OneCAnalytics = {
      calculatedAt: new Date(clock.rows[0].calculated_at).toISOString(),
      assets: { total: assets.rows.length, active, retired, other: assets.rows.length - active - retired, receivedAt: dates.length ? new Date(dates.reduce((a, b) => Math.max(a, b))).toISOString() : null },
      inventory: { total: items.rows.length, active: items.rows.filter(row => row.status === "active").length, quantity: items.rows.reduce((sum, row) => sum + Number(row.quantity), 0) },
      reconciliation: summarizeOneCAudit(audit.rows, sourceAssets.filter(row => row.asset.status === "Принято к учёту").map(row => row.externalId), materials.rows.map(row => row.sourceKey!)),
    };
    return {
      analytics, materials: materials.metadata, assets: sourceAssets, materialRecords: materials.records,
      rows: audit.rows,
      inventory: items.rows.map(row => ({ id: String(row.id), quantity: Number(row.quantity), status: String(row.status), oneCCode: row.one_c_code as string | null })),
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
