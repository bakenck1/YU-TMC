import { auditNeedsReview, type AuditMatch } from "@/lib/inventory-source-audit";

/** Categories partition Inventory cards; temporary numbers are an independent attribute. */
export function summarizeOneCAudit(rows: AuditMatch[], assetIds: string[], materialKeys: string[]) {
  const counts = { fixedAssets: 0, materials: 0, both: 0, possible: 0, missing: 0, temporary: 0 };
  const seenAssets = new Set<string>();
  const seenMaterials = new Set<string>();
  for (const row of rows) {
    if (row.numberKind === "temporary") counts.temporary++;
    for (const asset of row.oneC) seenAssets.add(asset.externalId);
    for (const material of row.excel) if (material.sourceKey) seenMaterials.add(material.sourceKey);
    if (!row.oneC.length && !row.excel.length) counts.missing++;
    else if (auditNeedsReview(row)) counts.possible++;
    else if (row.oneC.length && row.excel.length) counts.both++;
    else if (row.oneC.length) counts.fixedAssets++;
    else counts.materials++;
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
  assets: { total: number; active: number; retired: number; other: number; receivedAt: string | null };
  inventory: { total: number; active: number; quantity: number };
  reconciliation: ReturnType<typeof summarizeOneCAudit>;
};
