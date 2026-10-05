import { parseCode39ScanInput } from "@/lib/domain/code39";
import { createOneCIdentifierIndex, matchOneCFixedAssetIdentifiers } from "@/lib/one-c-reconciliation";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { extractExcelInventoryReferences, inventoryAuditNumberKey, inventoryAuditSlashlessKey, inventoryAuditSuffixStem, type ExcelInventoryReference } from "@/lib/inventory-audit-numbers";
export { extractExcelInventoryNumber, extractExcelInventoryReference, extractExcelInventoryReferences } from "@/lib/inventory-audit-numbers";
export type { ExcelInventoryReference } from "@/lib/inventory-audit-numbers";

export const INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION = 6;
export type ExcelSourceRow = ExcelInventoryReference & { rowNumber: number; nomenclature: string; endingBalance: string | null; inventoryReferences?: ExcelInventoryReference[]; matchedInventoryNumber?: string; matchedReference?: ExcelInventoryReference; matchedBy?: ("site_number" | "barcode" | "number_without_slash" | "number_in_description" | "number_suffix")[]; matchedBarcodes?: string[] };
export type AuditItem = { id: string; name: string; inventoryNumber: string; inventoryNumberKind: string; oneCCode: string | null; officialBarcodes: string[]; localBarcodes?: string[]; sourceCodes: string[]; version: number };
export type AuditOneCOrigin = "selected_batch" | "current_registry";
export type AuditOneCRow = { externalId: string; asset: OneCFixedAsset; origins?: AuditOneCOrigin[]; batchMatchedItemId?: string | null; reviewState?: string | null };
export type AuditMatch = { itemId: string; itemName: string; siteNumber: string; siteBarcodes: { value: string; kind: "official" | "local" }[]; numberKind: string; itemVersion: number; result: "matched" | "missing" | "temporary"; source: "1c" | "excel" | "1c+excel" | null; oneC: { externalId: string; code: string | null; inventoryNumber: string | null; barcode: string | null; name: string; status: string; reviewState?: string | null; origins: AuditOneCOrigin[]; matchedBy: ("guid" | "code" | "inventory_number" | "barcode" | "batch_analysis" | "number_without_slash" | "number_format" | "number_in_description" | "number_suffix")[]; matchedBarcodes: string[] }[]; excel: ExcelSourceRow[] };
export type AuditCounts = { total: number; oneCOnly: number; excelOnly: number; both: number; missing: number; temporary: number; possible?: number };

function barcodeNumber(value: string): string | null {
  const parsed = parseCode39ScanInput(value);
  if (parsed.ok) return parsed.fallbackKey ? null : parsed.inventoryNumber;
  const withoutMarker = parseCode39ScanInput(inventoryAuditNumberKey(value));
  return withoutMarker.ok && !withoutMarker.fallbackKey ? withoutMarker.inventoryNumber : null;
}

function numberWithoutSlashKey(value: string): string {
  return inventoryAuditSlashlessKey(value);
}

function differsOnlyBySlashes(left: string, right: string): boolean {
  const a = inventoryAuditNumberKey(left), b = inventoryAuditNumberKey(right);
  return a !== b && numberWithoutSlashKey(a) === numberWithoutSlashKey(b);
}

export function auditNeedsReview(row: AuditMatch): boolean {
  const reasons = [...row.oneC.flatMap((entry) => entry.matchedBy), ...row.excel.flatMap((entry) => entry.matchedBy ?? [])];
  return reasons.length > 0 && reasons.every(isWeakEvidence);
}

function isWeakEvidence(reason: string): boolean {
  return reason === "number_without_slash" || reason === "number_in_description" || reason === "number_format" || reason === "number_suffix";
}

function nameTokens(value: string): Set<string> {
  return new Set(value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 1 && /\p{L}/u.test(token) && !/^(?:no|n)\d+$/u.test(token) && !["no", "инв", "инвентарный", "номер", "от"].includes(token)) ?? []);
}

function nameScore(left: string, right: string): number {
  const a = nameTokens(left), b = nameTokens(right);
  if (!a.size || !b.size) return 0;
  const dice = (first: Set<string>, second: Set<string>) => {
    let shared = 0;
    for (const token of first) if (second.has(token)) shared++;
    return first.size + second.size ? 2 * shared / (first.size + second.size) : 0;
  };
  const trigrams = (tokens: Set<string>) => new Set([...tokens].flatMap((token) => {
    const padded = ` ${token} `;
    return Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) => padded.slice(index, index + 3));
  }));
  return 0.7 * dice(a, b) + 0.3 * dice(trigrams(a), trigrams(b));
}

export function buildInventorySourceAudit(items: AuditItem[], oneCRows: AuditOneCRow[], excelRows: ExcelSourceRow[], links: { externalId: string; itemId: string }[]): { rows: AuditMatch[]; counts: AuditCounts } {
  type IndexedExcel = { row: ExcelSourceRow; reference: ExcelInventoryReference; number: string };
  const excelByNumber = new Map<string, IndexedExcel[]>();
  const excelByNumberWithoutSlash = new Map<string, IndexedExcel[]>();
  const excelBySuffixStem = new Map<string, IndexedExcel[]>();
  for (const row of excelRows) {
    for (const reference of row.inventoryReferences ?? [row]) {
      for (const number of new Set([reference.inventoryNumber, reference.sourceInventoryNumber].filter((value): value is string => Boolean(value)))) {
        const entry = { row, reference: { inventoryNumber: reference.inventoryNumber, sourceInventoryNumber: reference.sourceInventoryNumber, numberIsUnmarked: reference.numberIsUnmarked }, number };
        const key = inventoryAuditNumberKey(number);
        const exactRows = excelByNumber.get(key) ?? [];
        exactRows.push(entry);
        excelByNumber.set(key, exactRows);
        const relaxedKey = numberWithoutSlashKey(number);
        const relaxedRows = excelByNumberWithoutSlash.get(relaxedKey) ?? [];
        relaxedRows.push(entry);
        excelByNumberWithoutSlash.set(relaxedKey, relaxedRows);
        const suffixStem = inventoryAuditSuffixStem(number);
        if (suffixStem) excelBySuffixStem.set(suffixStem, [...(excelBySuffixStem.get(suffixStem) ?? []), entry]);
      }
    }
  }
  const oneCByItem = new Map<string, AuditMatch["oneC"]>();
  const linkByExternalId = new Map(links.map((link) => [link.externalId, link.itemId]));
  const candidates = items.map((item) => ({ id: item.id, inventoryNumber: item.inventoryNumber, oneCCode: item.oneCCode, sourceCodes: item.sourceCodes, officialBarcodes: item.officialBarcodes }));
  const identifierIndex = createOneCIdentifierIndex(candidates);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const localOwnersByBarcode = new Map<string, string[]>();
  for (const item of items) for (const barcode of item.localBarcodes ?? []) {
    const parsed = parseCode39ScanInput(barcode);
    if (parsed.ok) {
      const owners = localOwnersByBarcode.get(parsed.value) ?? [];
      owners.push(item.id);
      localOwnersByBarcode.set(parsed.value, owners);
    }
  }
  const ownersByNumberWithoutSlash = new Map<string, { itemId: string; exactKey: string }[]>();
  const ownersByNumber = new Map<string, string[]>();
  const ownersBySuffixStem = new Map<string, string[]>();
  for (const item of items) {
    const siteNumbers = [item.inventoryNumber, ...[...item.officialBarcodes, ...(item.localBarcodes ?? [])].map(barcodeNumber).filter((value): value is string => Boolean(value))];
    for (const number of siteNumbers) {
      const exactKey = inventoryAuditNumberKey(number);
      const relaxedKey = numberWithoutSlashKey(number);
      const owners = ownersByNumberWithoutSlash.get(relaxedKey) ?? [];
      owners.push({ itemId: item.id, exactKey });
      ownersByNumberWithoutSlash.set(relaxedKey, owners);
      ownersByNumber.set(exactKey, [...(ownersByNumber.get(exactKey) ?? []), item.id]);
      const suffixStem = inventoryAuditSuffixStem(number);
      if (suffixStem) ownersBySuffixStem.set(suffixStem, [...(ownersBySuffixStem.get(suffixStem) ?? []), item.id]);
    }
  }
  for (const { externalId, asset, origins: sourceOrigins, batchMatchedItemId, reviewState } of oneCRows) {
    const origins: AuditOneCOrigin[] = sourceOrigins ?? ["current_registry"];
    const matches = matchOneCFixedAssetIdentifiers(asset, { items: candidates, index: identifierIndex, linkedItemId: linkByExternalId.get(externalId) });
    const ids = new Set([...matches.inventoryItemIds, ...matches.codeItemIds, ...matches.barcodeItemIds]);
    const linked = linkByExternalId.get(externalId);
    if (linked) ids.add(linked);
    if (origins.includes("selected_batch") && batchMatchedItemId) ids.add(batchMatchedItemId);
    const sourceBarcode = asset.barcode ? parseCode39ScanInput(asset.barcode) : { ok: false as const };
    if (sourceBarcode.ok) for (const id of localOwnersByBarcode.get(sourceBarcode.value) ?? []) ids.add(id);
    const sourceNumbers = [asset.inventoryNumber, asset.barcode ? barcodeNumber(asset.barcode) : null].filter((value): value is string => Boolean(value));
    const numberFormatIds = [...new Set(sourceNumbers.flatMap((sourceNumber) =>
      (ownersByNumberWithoutSlash.get(numberWithoutSlashKey(sourceNumber)) ?? [])
        .filter((owner) => owner.exactKey === inventoryAuditNumberKey(sourceNumber))
        .map((owner) => owner.itemId),
    ))];
    const numberWithoutSlashIds = [...new Set(sourceNumbers.flatMap((sourceNumber) =>
      (ownersByNumberWithoutSlash.get(numberWithoutSlashKey(sourceNumber)) ?? [])
        .filter((owner) => differsOnlyBySlashes(owner.exactKey, sourceNumber))
        .map((owner) => owner.itemId),
    ))];
    const descriptionNumbers = extractExcelInventoryReferences(asset.name).flatMap((reference) =>
      [reference.inventoryNumber, reference.sourceInventoryNumber].filter((value): value is string => Boolean(value)));
    const descriptionIds = [...new Set(descriptionNumbers.flatMap((number) =>
      (ownersByNumberWithoutSlash.get(numberWithoutSlashKey(number)) ?? []).map((owner) => owner.itemId),
    ))];
    const numberSuffixIds = [...new Set([...sourceNumbers, ...descriptionNumbers].flatMap((number) => {
      const suffixStem = inventoryAuditSuffixStem(number);
      return suffixStem ? ownersByNumber.get(suffixStem) ?? [] : ownersBySuffixStem.get(inventoryAuditNumberKey(number)) ?? [];
    }))];
    for (const id of [...numberFormatIds, ...numberWithoutSlashIds, ...descriptionIds, ...numberSuffixIds]) ids.add(id);
    for (const id of ids) {
      const item = itemById.get(id);
      if (!item) continue;
      const exactBarcodes = sourceBarcode.ok ? [...item.officialBarcodes, ...(item.localBarcodes ?? [])].filter((barcode) => {
        const parsed = parseCode39ScanInput(barcode);
        return parsed.ok && parsed.value === sourceBarcode.value;
      }) : [];
      const matchedBarcodes = [...new Set([...exactBarcodes, ...[...item.officialBarcodes, ...(item.localBarcodes ?? [])].filter((barcode) => {
        const number = barcodeNumber(barcode);
        return number && [...sourceNumbers, ...descriptionNumbers].some((sourceNumber) => numberWithoutSlashKey(number) === numberWithoutSlashKey(sourceNumber));
      })])];
      const matchedBy: AuditMatch["oneC"][number]["matchedBy"] = [
        ...(linked === id ? ["guid" as const] : []),
        ...(matches.codeItemIds.includes(id) ? ["code" as const] : []),
        ...(matches.inventoryItemIds.includes(id) ? ["inventory_number" as const] : []),
        ...(matches.barcodeItemIds.includes(id) || exactBarcodes.length ? ["barcode" as const] : []),
        ...(numberFormatIds.includes(id) && !matches.inventoryItemIds.includes(id) && !matches.barcodeItemIds.includes(id) && !exactBarcodes.length ? ["number_format" as const] : []),
        ...(numberWithoutSlashIds.includes(id) ? ["number_without_slash" as const] : []),
        ...(descriptionIds.includes(id) ? ["number_in_description" as const] : []),
        ...(numberSuffixIds.includes(id) ? ["number_suffix" as const] : []),
        ...(batchMatchedItemId === id && !matches.inventoryItemIds.includes(id) && !matches.codeItemIds.includes(id) && !matches.barcodeItemIds.includes(id) && linked !== id && !matchedBarcodes.length ? ["batch_analysis" as const] : []),
      ];
      oneCByItem.set(id, [...(oneCByItem.get(id) ?? []), { externalId, code: asset.code, inventoryNumber: asset.inventoryNumber, barcode: asset.barcode, name: asset.name, status: asset.status ?? "", reviewState: reviewState ?? null, origins, matchedBy, matchedBarcodes }]);
    }
  }
  const counts: AuditCounts = { total: items.length, oneCOnly: 0, excelOnly: 0, both: 0, missing: 0, temporary: 0, possible: 0 };
  const rows = items.map((item): AuditMatch => {
    const keys = new Map<string, { siteNumber: boolean; barcodes: string[] }>();
    if (item.inventoryNumber) keys.set(inventoryAuditNumberKey(item.inventoryNumber), { siteNumber: true, barcodes: [] });
    for (const barcode of [...item.officialBarcodes, ...(item.localBarcodes ?? [])]) {
      const number = barcodeNumber(barcode);
      if (number) {
        const key = inventoryAuditNumberKey(number);
        const evidence = keys.get(key) ?? { siteNumber: false, barcodes: [] };
        evidence.barcodes.push(barcode);
        keys.set(key, evidence);
      }
    }
    const excelCandidates = [...keys].flatMap(([key, evidence]) => [
      ...(excelByNumber.get(key) ?? []).map(({ row, reference, number }): ExcelSourceRow => ({
        ...row, matchedInventoryNumber: number, matchedReference: reference, matchedBy: reference.numberIsUnmarked ? ["number_in_description"] : [
          ...(evidence.siteNumber ? ["site_number" as const] : []),
          ...(evidence.barcodes.length ? ["barcode" as const] : []),
        ], matchedBarcodes: evidence.barcodes,
      })),
      ...(excelByNumberWithoutSlash.get(numberWithoutSlashKey(key)) ?? [])
        .filter(({ number }) => differsOnlyBySlashes(number, key))
        .map(({ row, reference, number }): ExcelSourceRow => ({ ...row, matchedInventoryNumber: number, matchedReference: reference, matchedBy: ["number_without_slash"], matchedBarcodes: evidence.barcodes })),
      ...(inventoryAuditSuffixStem(key) ? excelByNumber.get(inventoryAuditSuffixStem(key)!) ?? [] : excelBySuffixStem.get(key) ?? [])
        .map(({ row, reference, number }): ExcelSourceRow => ({ ...row, matchedInventoryNumber: number, matchedReference: reference, matchedBy: ["number_suffix"], matchedBarcodes: evidence.barcodes })),
    ]);
    const weakExcelMatch = (row: ExcelSourceRow) => row.matchedBy?.every(isWeakEvidence) ? 1 : 0;
    const uniqueExcelRows = new Map<number, ExcelSourceRow>();
    for (const row of excelCandidates.sort((a, b) => nameScore(item.name, b.nomenclature) - nameScore(item.name, a.nomenclature) || weakExcelMatch(a) - weakExcelMatch(b) || a.rowNumber - b.rowNumber)) {
      const existing = uniqueExcelRows.get(row.rowNumber);
      if (!existing) uniqueExcelRows.set(row.rowNumber, row);
      else {
        existing.matchedBy = [...new Set([...(existing.matchedBy ?? []), ...(row.matchedBy ?? [])])];
        existing.matchedBarcodes = [...new Set([...(existing.matchedBarcodes ?? []), ...(row.matchedBarcodes ?? [])])];
      }
    }
    const excel = [...uniqueExcelRows.values()];
    const oneC = (oneCByItem.get(item.id) ?? []).sort((a, b) =>
      nameScore(item.name, b.name) - nameScore(item.name, a.name)
      || Number(a.matchedBy.every(isWeakEvidence)) - Number(b.matchedBy.every(isWeakEvidence))
      || a.externalId.localeCompare(b.externalId) || a.origins.join().localeCompare(b.origins.join()));
    const source = oneC.length && excel.length ? "1c+excel" : oneC.length ? "1c" : excel.length ? "excel" : null;
    if (source === "1c+excel") counts.both++;
    else if (source === "1c") counts.oneCOnly++;
    else if (source === "excel") counts.excelOnly++;
    else counts.missing++;
    const temporary = item.inventoryNumberKind === "temporary" || /^TMP-/i.test(item.inventoryNumber);
    if (!source && temporary) counts.temporary++;
    const result: AuditMatch = { itemId: item.id, itemName: item.name, siteNumber: item.inventoryNumber, siteBarcodes: [...item.officialBarcodes.map((value) => ({ value, kind: "official" as const })), ...(item.localBarcodes ?? []).map((value) => ({ value, kind: "local" as const }))], numberKind: item.inventoryNumberKind, itemVersion: item.version, result: source ? "matched" : temporary ? "temporary" : "missing", source, oneC, excel };
    if (auditNeedsReview(result)) counts.possible = (counts.possible ?? 0) + 1;
    return result;
  }).sort((a, b) => a.itemId.localeCompare(b.itemId));
  return { rows, counts };
}
