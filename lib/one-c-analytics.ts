import type { AuditMatch } from "@/lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem, type InventoryAuditEnrichmentReason } from "@/lib/inventory-audit-enrichment";

export type OneCAuditPresence = {
  fixedAssets: boolean;
  materials: boolean;
  category: "fixedAssets" | "materials" | "both" | "possible" | "missing";
};

/** Presence needs a unique complete identifier; update-only name constraints do not deny presence. */
export function classifyOneCAudit(rows: readonly AuditMatch[]): Map<string, OneCAuditPresence> {
  const items: InventoryAuditEnrichmentItem[] = rows.map(row => ({
    id: row.itemId, name: row.itemName, inventoryNumber: row.siteNumber,
    officialBarcodes: row.siteBarcodes.filter(barcode => barcode.kind === "official").map(barcode => barcode.value),
    oneCCode: null, version: row.itemVersion, itemSection: "general",
  }));
  // Check each registry independently: OS update priority must not hide an MP identity conflict.
  // Keep all cards in each cohort, so one source reused across cards remains unconfirmed.
  const options = { allowDescriptionIdentity: true, includeIt: true };
  const assets = buildInventoryAuditEnrichmentPlan(rows.map(row => ({ ...row, excel: [] })), items, options);
  const materials = buildInventoryAuditEnrichmentPlan(rows.map(row => ({ ...row, oneC: [] })), items, options);
  const confirmed = (reason: InventoryAuditEnrichmentReason) => reason === "confirmed" || reason === "unchanged" || reason === "name_invalid";
  return new Map(rows.map((row, index) => {
    const fixedAssets = confirmed(assets.rows[index].reason);
    const material = confirmed(materials.rows[index].reason);
    const category = fixedAssets && material ? "both" : fixedAssets ? "fixedAssets" : material ? "materials"
      : row.oneC.length || row.excel.length ? "possible" : "missing";
    return [row.itemId, { fixedAssets, materials: material, category }];
  }));
}

/** Categories partition Inventory cards; temporary numbers are an independent attribute. */
export function summarizeOneCAudit(rows: AuditMatch[], assetIds: string[], materialKeys: string[]) {
  const counts = { fixedAssets: 0, materials: 0, both: 0, possible: 0, missing: 0, temporary: 0 };
  const seenAssets = new Set<string>();
  const seenMaterials = new Set<string>();
  const presence = classifyOneCAudit(rows);
  for (const row of rows) {
    if (row.numberKind === "temporary") counts.temporary++;
    for (const asset of row.oneC) seenAssets.add(asset.externalId);
    for (const material of row.excel) if (material.sourceKey) seenMaterials.add(material.sourceKey);
    counts[presence.get(row.itemId)!.category]++;
  }
  return {
    ...counts, total: rows.length,
    // Even a weak candidate prevents a claim that a source record is wholly absent.
    assetsWithoutCandidate: new Set(assetIds.filter(id => !seenAssets.has(id))).size,
    materialBalancesWithoutCandidate: new Set(materialKeys.filter(key => !seenMaterials.has(key))).size,
  };
}

export type OneCAnalytics = {
  calculatedAt: string;
  /** Current active scope: accepted OS, positive MP balances, active nonarchived cards. */
  assets: { total: number; active: number; retired: number; other: number; receivedAt: string | null };
  inventory: { total: number; active: number; quantity: number };
  reconciliation: ReturnType<typeof summarizeOneCAudit>;
};
