import { parseCode39ScanInput } from "@/lib/domain/code39";
import { extractExcelInventoryReferences, inventoryAuditNumberKey, inventoryAuditSpacelessKey } from "@/lib/inventory-audit-numbers";
import type { AuditMatch, ExcelSourceRow } from "@/lib/inventory-source-audit";

export type InventoryAuditEnrichmentItem = {
  id: string;
  name: string;
  inventoryNumber: string;
  officialBarcodes: readonly string[];
  oneCCode: string | null;
  version: number;
  itemSection: string;
  archivedAt?: string | Date | null;
  quantity?: number;
};

export type InventoryAuditEnrichmentReason = "confirmed" | "unchanged" | "item_not_found" | "item_ineligible" | "item_changed" | "sources_missing" | "source_ambiguous" | "source_reused" | "code_missing" | "code_conflict" | "identity_conflict" | "identity_missing" | "name_invalid";

export type InventoryAuditEnrichmentRow = {
  itemId: string;
  itemVersion: number;
  currentName: string;
  currentCode: string | null;
  nextName: string;
  nextCode: string | null;
  eligible: boolean;
  changed: boolean;
  reason: InventoryAuditEnrichmentReason;
  missingSources?: Array<"1c" | "excel">;
  externalId?: string;
  excelRowNumber?: number;
};

export type InventoryAuditEnrichmentPlan = {
  rows: InventoryAuditEnrichmentRow[];
  counts: { ready: number; unchanged: number; skipped: number };
};

function code(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim();
  return normalized || null;
}

function number(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = inventoryAuditNumberKey(value);
  if (!key || /^(?:tmp-|yui-)/iu.test(key)) return null;
  return inventoryAuditSpacelessKey(key) ?? key;
}

function barcode(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = parseCode39ScanInput(value);
  return parsed.ok ? parsed.fallbackKey ? null : number(parsed.inventoryNumber) : number(value);
}

function oneCSourceSnapshot(source: AuditMatch["oneC"][number]): string {
  // A rejected claim must not disappear beside an absent field in another copy.
  const claim = (value: string | null, normalized: string | null) => value == null ? null : normalized ?? value.normalize("NFKC").trim();
  return JSON.stringify([code(source.code), claim(source.inventoryNumber, number(source.inventoryNumber)),
    claim(source.barcode, barcode(source.barcode)), source.name.trim()]);
}

/** Removing one slash is allowed only when its boundary is not contradicted elsewhere. */
function agrees(left: string, right: string): boolean {
  if (left === right) return true;
  const withSlash = left.includes("/") ? left : right;
  const withoutSlash = left.includes("/") ? right : left;
  return /^\d+\/\d+$/u.test(withSlash) && /^\d+$/u.test(withoutSlash)
    && withSlash.replace("/", "") === withoutSlash;
}

function allAgree(values: readonly string[], anchor: string): boolean {
  return values.every((value) => agrees(value, anchor))
    && values.every((value, index) => values.slice(index + 1).every((other) => agrees(value, other)));
}

function officialSnapshot(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => inventoryAuditNumberKey(value)))].sort();
}

function sameOfficialSnapshot(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(officialSnapshot(left)) === JSON.stringify(officialSnapshot(right));
}

function descriptionNumbers(value: string): string[] {
  // A model number in free text is not an identity claim. Explicit inventory
  // markers are checked, including their unabridged range/suffix evidence.
  return extractExcelInventoryReferences(value).filter((reference) => !reference.numberIsUnmarked)
    .flatMap((reference) => [reference.inventoryNumber, reference.sourceInventoryNumber])
    .map(number).filter((value): value is string => Boolean(value));
}

function excelNumbers(row: ExcelSourceRow): string[] {
  return [row.inventoryNumber, row.sourceInventoryNumber, row.matchedInventoryNumber,
    ...[...(row.inventoryReferences ?? []), ...(row.matchedReference ? [row.matchedReference] : [])]
      .flatMap((reference) => [reference.inventoryNumber, reference.sourceInventoryNumber])]
    .map(number).filter((value): value is string => Boolean(value));
}

function own(map: Map<string, Set<string>>, key: string, itemId: string): void {
  const owners = map.get(key) ?? new Set<string>();
  owners.add(itemId);
  map.set(key, owners);
}

/** Plans existing-card updates without mutating either live data or saved evidence. */
export function buildInventoryAuditEnrichmentPlan(auditRows: readonly AuditMatch[], items: readonly InventoryAuditEnrichmentItem[]): InventoryAuditEnrichmentPlan {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const oneCOwners = new Map<string, Set<string>>();
  const excelOwners = new Map<string, Set<string>>();
  const auditRowCount = new Map<string, number>();
  for (const row of auditRows) {
    auditRowCount.set(row.itemId, (auditRowCount.get(row.itemId) ?? 0) + 1);
    for (const source of row.oneC) own(oneCOwners, source.externalId, row.itemId);
    for (const source of row.excel) own(excelOwners, String(source.rowNumber), row.itemId);
  }
  const counts = { ready: 0, unchanged: 0, skipped: 0 };
  const rows = auditRows.map((row): InventoryAuditEnrichmentRow => {
    const item = itemsById.get(row.itemId);
    const result: InventoryAuditEnrichmentRow = {
      itemId: row.itemId, itemVersion: item?.version ?? row.itemVersion,
      currentName: item?.name ?? row.itemName, currentCode: item?.oneCCode ?? null,
      nextName: item?.name ?? row.itemName, nextCode: item?.oneCCode ?? null,
      eligible: false, changed: false, reason: "sources_missing",
    };
    const skip = (reason: InventoryAuditEnrichmentReason) => {
      result.reason = reason;
      counts.skipped++;
      return result;
    };
    if (!item) return skip("item_not_found");
    if (item.archivedAt || item.itemSection !== "general") return skip("item_ineligible");
    if (item.version !== row.itemVersion || item.name !== row.itemName
      || inventoryAuditNumberKey(item.inventoryNumber) !== inventoryAuditNumberKey(row.siteNumber)
      || !sameOfficialSnapshot(item.officialBarcodes, row.siteBarcodes.filter((entry) => entry.kind === "official").map((entry) => entry.value))) return skip("item_changed");
    if (auditRowCount.get(item.id) !== 1) return skip("source_ambiguous");
    const oneC = row.oneC.filter((entry) => Array.isArray(entry.origins)
      && entry.origins.some((origin) => origin === "selected_batch" || origin === "current_registry"));
    if (!oneC.length || !row.excel.length) {
      result.missingSources = [...(!oneC.length ? ["1c" as const] : []), ...(!row.excel.length ? ["excel" as const] : [])];
      return skip("sources_missing");
    }
    // Multiple selected/current copies are safe only if their entire identity
    // and proposed values agree. Different source identities are never ranked.
    const distinct = new Map<string, AuditMatch["oneC"][number]>();
    for (const entry of oneC) {
      const existing = distinct.get(entry.externalId);
      if (existing && oneCSourceSnapshot(existing) !== oneCSourceSnapshot(entry)) return skip("source_ambiguous");
      distinct.set(entry.externalId, entry);
    }
    if (distinct.size !== 1 || row.excel.length !== 1) return skip("source_ambiguous");
    const source = [...distinct.values()][0], excel = row.excel[0];
    if (!source.externalId || !Number.isSafeInteger(excel.rowNumber) || excel.rowNumber < 1) return skip("source_ambiguous");
    if ((oneCOwners.get(source.externalId)?.size ?? 0) > 1 || (excelOwners.get(String(excel.rowNumber))?.size ?? 0) > 1) return skip("source_reused");
    const oneCCode = code(source.code), excelCode = code(excel.oneCCode);
    if (!oneCCode || !excelCode) return skip("code_missing");
    if (oneCCode.length > 64 || excelCode.length > 64 || oneCCode !== excelCode
      || (code(item.oneCCode) !== null && code(item.oneCCode) !== oneCCode)) return skip("code_conflict");
    const sourceNumber = number(source.inventoryNumber), sourceBarcode = barcode(source.barcode);
    const sourceIdentity = sourceNumber ?? sourceBarcode;
    const excelIdentities = excelNumbers(excel);
    if (!sourceIdentity || !excelIdentities.length) return skip("identity_missing");
    const officialBarcodes = item.officialBarcodes.map(barcode).filter((value): value is string => Boolean(value));
    const siteNumber = number(item.inventoryNumber);
    const siteIdentities = [siteNumber, ...officialBarcodes].filter((value): value is string => Boolean(value));
    const descriptionClaims = [...descriptionNumbers(source.name), ...descriptionNumbers(excel.nomenclature)];
    if (!allAgree([...excelIdentities, ...descriptionClaims], sourceIdentity)
      || !siteIdentities.some((identity) => allAgree([...excelIdentities, ...descriptionClaims, identity], sourceIdentity))
      || (siteNumber && !allAgree([siteNumber, ...excelIdentities], sourceIdentity))) return skip("identity_conflict");
    if (source.barcode && (!sourceBarcode || !officialBarcodes.some((value) => agrees(value, sourceBarcode)))) return skip("identity_conflict");
    const name = source.name.trim();
    if (!name || [...name].length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(name)) return skip("name_invalid");
    result.externalId = source.externalId;
    result.excelRowNumber = excel.rowNumber;
    result.nextName = name;
    result.nextCode = oneCCode;
    result.eligible = true;
    result.changed = item.name !== name || item.oneCCode !== oneCCode;
    result.reason = result.changed ? "confirmed" : "unchanged";
    if (result.changed) counts.ready++; else counts.unchanged++;
    return result;
  });
  return { rows, counts };
}
