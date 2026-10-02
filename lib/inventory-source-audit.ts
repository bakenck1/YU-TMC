import { inventoryNumberComparisonKey, parseCode39ScanInput } from "@/lib/domain/code39";
import { matchOneCFixedAssetIdentifiers } from "@/lib/one-c-reconciliation";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";

export const INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION = 4;
export type ExcelInventoryReference = { inventoryNumber: string; sourceInventoryNumber?: string; numberIsUnmarked?: boolean };
export type ExcelSourceRow = ExcelInventoryReference & { rowNumber: number; nomenclature: string; endingBalance: string | null; matchedBy?: ("site_number" | "barcode" | "number_without_slash" | "number_in_description")[]; matchedBarcodes?: string[] };
export type AuditItem = { id: string; name: string; inventoryNumber: string; inventoryNumberKind: string; oneCCode: string | null; officialBarcodes: string[]; localBarcodes?: string[]; sourceCodes: string[]; version: number };
export type AuditOneCOrigin = "selected_batch" | "current_registry";
export type AuditOneCRow = { externalId: string; asset: OneCFixedAsset; origins?: AuditOneCOrigin[]; batchMatchedItemId?: string | null; reviewState?: string | null };
export type AuditMatch = { itemId: string; itemName: string; siteNumber: string; siteBarcodes: { value: string; kind: "official" | "local" }[]; numberKind: string; itemVersion: number; result: "matched" | "missing" | "temporary"; source: "1c" | "excel" | "1c+excel" | null; oneC: { externalId: string; code: string | null; inventoryNumber: string | null; barcode: string | null; name: string; status: string; reviewState?: string | null; origins: AuditOneCOrigin[]; matchedBy: ("guid" | "code" | "inventory_number" | "barcode" | "batch_analysis" | "number_without_slash")[]; matchedBarcodes: string[] }[]; excel: ExcelSourceRow[] };
export type AuditCounts = { total: number; oneCOnly: number; excelOnly: number; both: number; missing: number; temporary: number; possible?: number };

/** Keeps the first range member and the literal range, without inventing other members. */
export function extractExcelInventoryReference(value: string): ExcelInventoryReference | null {
  const marked = /(?:№|(?<![\p{L}\p{N}])(?:инв(?:ентарный)?\.?(?:\s+номер)?\s*(?:№|No\.?|N\.?)?|No\.?|N\.?))\s*([0-9]+(?:\s*[/-]\s*[0-9]+|\s+[0-9]+(?![0-9.]|\s+(?:этаж|шт(?:ук)?|кг|мм|см|метр)(?![\p{L}\p{N}])))*)(?![\p{L}\p{N}/-]|\.\d|\s*[/-]\s*\d)/iu.exec(value);
  // Unmarked composite numbers are evidence to review: a model can have the same syntax.
  // Boundaries exclude dates, dimensions, slash lists and numbers attached to model letters.
  const unmarked = marked ? null : /(?<![\p{L}\p{N}/.\-]|[/-]\s*)([0-9]{3,6}\s*\/\s*[0-9]{3,8}(?:\s*-\s*[0-9]+)?)(?![\p{L}\p{N}/-]|\.\d|\s*[/-]\s*\d)/u.exec(value);
  const token = (marked ?? unmarked)?.[1].normalize("NFKC").trim();
  if (!token) return null;
  const inventoryNumber = /^\d+\s*\/\s*\d+\s*-\s*\d+$/u.test(token) ? token.replace(/\s*-\s*\d+$/u, "") : token;
  return { inventoryNumber, ...(token !== inventoryNumber ? { sourceInventoryNumber: token } : {}), ...(unmarked ? { numberIsUnmarked: true } : {}) };
}

export function extractExcelInventoryNumber(value: string): string | null {
  return extractExcelInventoryReference(value)?.inventoryNumber ?? null;
}

function barcodeNumber(value: string): string | null {
  const parsed = parseCode39ScanInput(value);
  return parsed.ok && !parsed.fallbackKey ? parsed.inventoryNumber : null;
}

function numberWithoutSlashKey(value: string): string {
  return inventoryNumberComparisonKey(value).replaceAll("/", "");
}

function differsByOneSlash(left: string, right: string): boolean {
  const a = inventoryNumberComparisonKey(left), b = inventoryNumberComparisonKey(right);
  const slashCount = (value: string) => value.length - value.replaceAll("/", "").length;
  return a !== b && Math.abs(slashCount(a) - slashCount(b)) === 1 && numberWithoutSlashKey(a) === numberWithoutSlashKey(b);
}

export function auditNeedsReview(row: AuditMatch): boolean {
  const reasons = [...row.oneC.flatMap((entry) => entry.matchedBy), ...row.excel.flatMap((entry) => entry.matchedBy ?? [])];
  return reasons.length > 0 && reasons.every((reason) => reason === "number_without_slash" || reason === "number_in_description");
}

function nameTokens(value: string): Set<string> {
  return new Set(value.normalize("NFKC").toLocaleLowerCase("ru-RU").match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 1) ?? []);
}

function nameScore(left: string, right: string): number {
  const a = nameTokens(left), b = nameTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return 2 * shared / (a.size + b.size);
}

export function buildInventorySourceAudit(items: AuditItem[], oneCRows: AuditOneCRow[], excelRows: ExcelSourceRow[], links: { externalId: string; itemId: string }[]): { rows: AuditMatch[]; counts: AuditCounts } {
  const excelByNumber = new Map<string, ExcelSourceRow[]>();
  const excelByNumberWithoutSlash = new Map<string, ExcelSourceRow[]>();
  for (const row of excelRows) {
    for (const number of new Set([row.inventoryNumber, row.sourceInventoryNumber].filter((value): value is string => Boolean(value)))) {
      const key = inventoryNumberComparisonKey(number);
      const exactRows = excelByNumber.get(key) ?? [];
      exactRows.push(row);
      excelByNumber.set(key, exactRows);
    }
    const relaxedKey = numberWithoutSlashKey(row.inventoryNumber);
    const relaxedRows = excelByNumberWithoutSlash.get(relaxedKey) ?? [];
    relaxedRows.push(row);
    excelByNumberWithoutSlash.set(relaxedKey, relaxedRows);
  }
  const oneCByItem = new Map<string, AuditMatch["oneC"]>();
  const linkByExternalId = new Map(links.map((link) => [link.externalId, link.itemId]));
  const candidates = items.map((item) => ({ id: item.id, inventoryNumber: item.inventoryNumber, oneCCode: item.oneCCode, sourceCodes: item.sourceCodes, officialBarcodes: item.officialBarcodes }));
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
  for (const item of items) {
    const siteNumbers = [item.inventoryNumber, ...[...item.officialBarcodes, ...(item.localBarcodes ?? [])].map(barcodeNumber).filter((value): value is string => Boolean(value))];
    for (const number of siteNumbers) {
      const exactKey = inventoryNumberComparisonKey(number);
      const relaxedKey = numberWithoutSlashKey(number);
      const owners = ownersByNumberWithoutSlash.get(relaxedKey) ?? [];
      owners.push({ itemId: item.id, exactKey });
      ownersByNumberWithoutSlash.set(relaxedKey, owners);
    }
  }
  for (const { externalId, asset, origins: sourceOrigins, batchMatchedItemId, reviewState } of oneCRows) {
    const origins: AuditOneCOrigin[] = sourceOrigins ?? ["current_registry"];
    const matches = matchOneCFixedAssetIdentifiers(asset, { items: candidates, linkedItemId: linkByExternalId.get(externalId) });
    const ids = new Set([...matches.inventoryItemIds, ...matches.codeItemIds, ...matches.barcodeItemIds]);
    const linked = linkByExternalId.get(externalId);
    if (linked) ids.add(linked);
    if (origins.includes("selected_batch") && batchMatchedItemId) ids.add(batchMatchedItemId);
    const sourceBarcode = asset.barcode ? parseCode39ScanInput(asset.barcode) : { ok: false as const };
    if (sourceBarcode.ok) for (const id of localOwnersByBarcode.get(sourceBarcode.value) ?? []) ids.add(id);
    const sourceNumbers = [asset.inventoryNumber, asset.barcode ? barcodeNumber(asset.barcode) : null].filter((value): value is string => Boolean(value));
    const numberWithoutSlashIds = [...new Set(sourceNumbers.flatMap((sourceNumber) =>
      (ownersByNumberWithoutSlash.get(numberWithoutSlashKey(sourceNumber)) ?? [])
        .filter((owner) => differsByOneSlash(owner.exactKey, sourceNumber))
        .map((owner) => owner.itemId),
    ))];
    for (const id of numberWithoutSlashIds) ids.add(id);
    for (const id of ids) {
      const item = itemById.get(id);
      if (!item) continue;
      const matchedBarcodes = sourceBarcode.ok ? [...item.officialBarcodes, ...(item.localBarcodes ?? [])].filter((barcode) => {
        const parsed = parseCode39ScanInput(barcode);
        return parsed.ok && parsed.value === sourceBarcode.value;
      }) : [];
      const matchedBy: AuditMatch["oneC"][number]["matchedBy"] = [
        ...(linked === id ? ["guid" as const] : []),
        ...(matches.codeItemIds.includes(id) ? ["code" as const] : []),
        ...(matches.inventoryItemIds.includes(id) ? ["inventory_number" as const] : []),
        ...(matches.barcodeItemIds.includes(id) || matchedBarcodes.length ? ["barcode" as const] : []),
        ...(numberWithoutSlashIds.includes(id) ? ["number_without_slash" as const] : []),
        ...(batchMatchedItemId === id && !matches.inventoryItemIds.includes(id) && !matches.codeItemIds.includes(id) && !matches.barcodeItemIds.includes(id) && linked !== id && !matchedBarcodes.length ? ["batch_analysis" as const] : []),
      ];
      oneCByItem.set(id, [...(oneCByItem.get(id) ?? []), { externalId, code: asset.code, inventoryNumber: asset.inventoryNumber, barcode: asset.barcode, name: asset.name, status: asset.status ?? "", reviewState: reviewState ?? null, origins, matchedBy, matchedBarcodes }]);
    }
  }
  const counts: AuditCounts = { total: items.length, oneCOnly: 0, excelOnly: 0, both: 0, missing: 0, temporary: 0, possible: 0 };
  const rows = items.map((item): AuditMatch => {
    const keys = new Map<string, { siteNumber: boolean; barcodes: string[] }>();
    if (item.inventoryNumber) keys.set(inventoryNumberComparisonKey(item.inventoryNumber), { siteNumber: true, barcodes: [] });
    for (const barcode of [...item.officialBarcodes, ...(item.localBarcodes ?? [])]) {
      const number = barcodeNumber(barcode);
      if (number) {
        const key = inventoryNumberComparisonKey(number);
        const evidence = keys.get(key) ?? { siteNumber: false, barcodes: [] };
        evidence.barcodes.push(barcode);
        keys.set(key, evidence);
      }
    }
    const excelCandidates = [...keys].flatMap(([key, evidence]) => [
      ...(excelByNumber.get(key) ?? []).map((row): ExcelSourceRow => ({
        ...row, matchedBy: row.numberIsUnmarked ? ["number_in_description"] : [
          ...(evidence.siteNumber ? ["site_number" as const] : []),
          ...(evidence.barcodes.length ? ["barcode" as const] : []),
        ], matchedBarcodes: evidence.barcodes,
      })),
      ...(excelByNumberWithoutSlash.get(numberWithoutSlashKey(key)) ?? [])
        .filter((row) => differsByOneSlash(row.inventoryNumber, key))
        .map((row): ExcelSourceRow => ({ ...row, matchedBy: ["number_without_slash"], matchedBarcodes: evidence.barcodes })),
    ]);
    const weakExcelMatch = (row: ExcelSourceRow) => row.matchedBy?.every((reason) => reason === "number_without_slash" || reason === "number_in_description") ? 1 : 0;
    const uniqueExcelRows = new Map<number, ExcelSourceRow>();
    for (const row of excelCandidates.sort((a, b) => weakExcelMatch(a) - weakExcelMatch(b) || nameScore(item.name, b.nomenclature) - nameScore(item.name, a.nomenclature) || a.rowNumber - b.rowNumber)) {
      const existing = uniqueExcelRows.get(row.rowNumber);
      if (!existing) uniqueExcelRows.set(row.rowNumber, row);
      else {
        existing.matchedBy = [...new Set([...(existing.matchedBy ?? []), ...(row.matchedBy ?? [])])];
        existing.matchedBarcodes = [...new Set([...(existing.matchedBarcodes ?? []), ...(row.matchedBarcodes ?? [])])];
      }
    }
    const excel = [...uniqueExcelRows.values()];
    const oneC = (oneCByItem.get(item.id) ?? []).sort((a, b) =>
      Number(a.matchedBy.every((reason) => reason === "number_without_slash")) - Number(b.matchedBy.every((reason) => reason === "number_without_slash"))
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
