import type { AuditMatch } from "@/lib/inventory-source-audit";
import { extractExcelInventoryReferences, extractFormattedInventoryReferences, extractSourceBarcodeNumbers, inventoryAuditNumbersEqual, inventoryAuditSourceRanges, inventoryAuditRangeContains, inventoryAuditItemNameNumbers } from "@/lib/inventory-audit-numbers";
import { parseCode39ScanInput } from "@/lib/domain/code39";
import { exactMaterialCode } from "@/lib/one-c-material-code";
import { oneCNameOwnerCanIdentify } from "@/lib/one-c-source-name";

export type OneCAuditPresence = {
  fixedAssets: boolean;
  materials: boolean;
  category: "fixedAssets" | "materials" | "both" | "possible" | "missing";
};

/** Existence requires a complete identifier or verified temporary-card name+owner evidence. */
export function classifyOneCAudit(rows: readonly AuditMatch[]): Map<string, OneCAuditPresence> {
  const decode = (value: string | null | undefined) => {
    if (!value) return null;
    const parsed = parseCode39ScanInput(value);
    const result = parsed.ok ? parsed.fallbackKey ? null : parsed.inventoryNumber : value;
    return result && !/^(?:TMP-|YUI-)/iu.test(result) ? result : null;
  };
  return new Map(rows.map(row => {
    const anchors = [decode(row.siteNumber), ...row.siteBarcodes.map(entry => decode(entry.value)), ...inventoryAuditItemNameNumbers(row.itemName).map(decode)].filter((value): value is string => Boolean(value));
    const matches = (name: string, number?: string | null, barcode?: string | null, quantity?: number) => {
      const references = [...extractExcelInventoryReferences(name).map(ref => ref.sourceInventoryNumber ?? ref.inventoryNumber),
        ...extractFormattedInventoryReferences(name).map(ref => ref.inventoryNumber), ...extractSourceBarcodeNumbers(name)];
      const claims = [decode(number), decode(barcode), ...references].filter((value): value is string => Boolean(value));
      return claims.some(claim => anchors.some(anchor => inventoryAuditNumbersEqual(anchor, claim)))
        || inventoryAuditSourceRanges(name, number, quantity).some(range => anchors.some(anchor => inventoryAuditRangeContains(anchor, range)));
    };
    const sourceCode = exactMaterialCode(row.siteOneCCode);
    const ownerMatches = (name: string, responsibleName?: string | null) => oneCNameOwnerCanIdentify({ name: row.itemName, inventoryNumber: row.siteNumber, inventoryNumberKind: row.numberKind, responsibleName: row.siteResponsibleName, oneCCode: row.siteOneCCode }, name, responsibleName);
    const fixedAssets = row.oneC.some(entry => (sourceCode !== null && exactMaterialCode(entry.code) === sourceCode) || matches(entry.name, entry.inventoryNumber, entry.barcode, entry.quantity)
      || entry.matchedBy.includes("name_owner") && ownerMatches(entry.name, entry.responsibleName));
    const quantities = new Map<string, number>();
    for (const entry of row.excel) if (entry.oneCCode) quantities.set(entry.oneCCode, (quantities.get(entry.oneCCode) ?? 0) + Number(entry.endingBalance ?? 0));
    const materialCode = sourceCode;
    const codeMatched = row.excel.some(entry => entry.sourceKind === "materials_api" && Number(entry.endingBalance) > 0 && materialCode !== null && exactMaterialCode(entry.oneCCode) === materialCode);
    const material = codeMatched || row.excel.some(entry => matches(entry.nomenclature, entry.explicitInventoryNumber ?? (entry.sourceKind === "materials_api" ? null : entry.sourceInventoryNumber ?? entry.inventoryNumber), entry.barcode,
      entry.oneCCode ? quantities.get(entry.oneCCode) : Number(entry.endingBalance ?? 0))
      || entry.sourceKind === "materials_api" && Number(entry.endingBalance) > 0 && entry.matchedBy?.includes("name_owner") && ownerMatches(entry.nomenclature, entry.responsibleName));
    const category = fixedAssets && material ? "both" : fixedAssets ? "fixedAssets" : material ? "materials"
      : row.oneC.length || row.excel.length ? "possible" : "missing";
    return [row.itemId, { fixedAssets, materials: material, category }];
  }));
}

/** Categories partition Inventory cards; temporary numbers are an independent attribute. */
export function summarizeOneCAudit(rows: AuditMatch[], assetIds: string[], materialKeys: string[]) {
  const counts = { fixedAssets: 0, materials: 0, both: 0, possible: 0, missing: 0, temporary: 0, temporaryUnmatched: 0, temporaryFound: 0, temporaryPossible: 0 };
  const seenAssets = new Set<string>();
  const seenMaterials = new Set<string>();
  const presence = classifyOneCAudit(rows);
  for (const row of rows) {
    if (row.numberKind === "temporary") counts.temporary++;
    for (const asset of row.oneC) seenAssets.add(asset.externalId);
    for (const material of row.excel) if (material.sourceKey) seenMaterials.add(material.sourceKey);
    const category = presence.get(row.itemId)!.category;
    if (row.numberKind === "temporary") {
      if (category === "possible") counts.temporaryPossible++;
      else if (category !== "missing") counts.temporaryFound++;
    }
    if (category === "missing" && row.numberKind === "temporary") counts.temporaryUnmatched++;
    else counts[category]++;
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
  /** Stock totals are active; presence is checked across all OS records and nonarchived cards. */
  assets: { total: number; active: number; retired: number; other: number; receivedAt: string | null };
  inventory: { total: number; active: number; quantity: number };
  reconciliation: Omit<ReturnType<typeof summarizeOneCAudit>, "temporaryUnmatched" | "temporaryFound" | "temporaryPossible"> & { temporaryUnmatched?: number; temporaryFound?: number; temporaryPossible?: number };
};
