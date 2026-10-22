import "server-only";
import type { Pool } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { buildInventorySourceAudit, type AuditItem } from "@/lib/inventory-source-audit";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { summarizeOneCAudit, type OneCAnalytics } from "@/lib/one-c-analytics";
import { readMaterialRegistry } from "@/lib/server/one-c-material-registry";

type AnalyticsInventoryItem = {
  id: string; quantity: number; status: string; oneCCode: string | null;
  unitPrice?: string | null; responsibleName?: string | null;
};

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
    const items = await client.query(`select i.id,i.name,i.inventory_number,i.inventory_number_kind,i.one_c_code,i.version,i.status,i.quantity,i.unit_price,
      (select u.full_name from yu_inventory.responsibility_periods p join yu_inventory.users u on u.id=p.responsible_user_id where p.item_id=i.id and p.ended_at is null) as responsible_name,
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
    const registryAssets = assets.rows.map(row => ({ externalId: String(row.external_id), asset: row.payload as OneCFixedAsset, origins: ["current_registry" as const] }));
    const sourceAssets = registryAssets.filter(row => row.asset.status === "Принято к учёту");
    const materialRecords = materials.records.filter(row => Number(row.material.quantity) > 0);
    const activeMaterials = {
      ...materials.metadata, rowCount: materialRecords.length,
      materialCount: new Set(materialRecords.map(row => row.material.code)).size,
      positiveRows: materialRecords.length, nonPositiveRows: 0,
    };
    const audit = buildInventorySourceAudit(auditItems, registryAssets, materials.rows, links.rows.map(row => ({ externalId: row.external_id, itemId: row.item_id })), { descriptionBarcodes: true, formattedNumbers: true });
    const dates = assets.rows.map(row => new Date(row.last_seen_at ?? row.received_at).valueOf()).filter(Number.isFinite);
    const analytics: OneCAnalytics = {
      calculatedAt: new Date(clock.rows[0].calculated_at).toISOString(),
      assets: { total: sourceAssets.length, active: sourceAssets.length, retired: 0, other: 0, receivedAt: dates.length ? new Date(dates.reduce((a, b) => Math.max(a, b))).toISOString() : null },
      inventory: { total: items.rows.length, active: items.rows.filter(row => row.status === "active").length, quantity: items.rows.reduce((sum, row) => sum + Number(row.quantity), 0) },
      reconciliation: summarizeOneCAudit(audit.rows, sourceAssets.map(row => row.externalId), materials.rows.map(row => row.sourceKey!)),
    };
    const inventory: AnalyticsInventoryItem[] = items.rows.map(row => ({
      id: String(row.id), quantity: Number(row.quantity), status: String(row.status),
      oneCCode: row.one_c_code as string | null, unitPrice: row.unit_price as string | null,
      responsibleName: row.responsible_name as string | null,
    }));
    return {
      analytics, materials: activeMaterials, assets: sourceAssets, registryAssets, materialRecords,
      rows: audit.rows,
      inventory,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
