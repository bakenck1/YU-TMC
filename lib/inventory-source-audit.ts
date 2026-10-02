import { inventoryNumberComparisonKey, parseCode39ScanInput } from "@/lib/domain/code39";
import { matchOneCFixedAssetIdentifiers } from "@/lib/one-c-reconciliation";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";

export type ExcelSourceRow = { rowNumber: number; nomenclature: string; inventoryNumber: string; endingBalance: string | null; matchedBy?: ("site_number" | "barcode")[]; matchedBarcodes?: string[] };
export type AuditItem = { id: string; name: string; inventoryNumber: string; inventoryNumberKind: string; oneCCode: string | null; officialBarcodes: string[]; localBarcodes?: string[]; sourceCodes: string[]; version: number };
export type AuditOneCOrigin = "selected_batch" | "current_registry";
export type AuditOneCRow = { externalId: string; asset: OneCFixedAsset; origins?: AuditOneCOrigin[]; batchMatchedItemId?: string | null };
export type AuditMatch = { itemId: string; itemName: string; siteNumber: string; siteBarcodes: { value: string; kind: "official" | "local" }[]; numberKind: string; itemVersion: number; result: "matched" | "missing" | "temporary"; source: "1c" | "excel" | "1c+excel" | null; oneC: { externalId: string; code: string | null; inventoryNumber: string | null; barcode: string | null; name: string; status: string; origins: AuditOneCOrigin[]; matchedBy: ("guid" | "code" | "inventory_number" | "barcode" | "batch_analysis")[]; matchedBarcodes: string[] }[]; excel: ExcelSourceRow[] };
export type AuditCounts = { total: number; oneCOnly: number; excelOnly: number; both: number; missing: number; temporary: number };

/** Extracts only the first marked number. A slash-prefix range has one searchable number. */
export function extractExcelInventoryNumber(value: string): string | null {
  const marker = /№\s*([0-9]+(?:\s*[/-]\s*[0-9]+)*(?:\s+[0-9]+(?![0-9.]))*)/u.exec(value);
  if (!marker) return null;
  let number = marker[1].normalize("NFKC").trim();
  if (/\d\s*\/\s*\d+\s*-\s*\d+$/u.test(number)) number = number.replace(/\s*-\s*\d+$/u, "");
  return number || null;
}

function barcodeNumber(value: string): string | null {
  const parsed = parseCode39ScanInput(value);
  return parsed.ok && !parsed.fallbackKey ? parsed.inventoryNumber : null;
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
  for (const row of excelRows) {
    const key = inventoryNumberComparisonKey(row.inventoryNumber);
    excelByNumber.set(key, [...(excelByNumber.get(key) ?? []), row]);
  }
  const oneCByItem = new Map<string, AuditMatch["oneC"]>();
  const linkByExternalId = new Map(links.map((link) => [link.externalId, link.itemId]));
  const candidates = items.map((item) => ({ id: item.id, inventoryNumber: item.inventoryNumber, oneCCode: item.oneCCode, sourceCodes: item.sourceCodes, officialBarcodes: item.officialBarcodes }));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const localOwnersByBarcode = new Map<string, string[]>();
  for (const item of items) for (const barcode of item.localBarcodes ?? []) {
    const parsed = parseCode39ScanInput(barcode);
    if (parsed.ok) localOwnersByBarcode.set(parsed.value, [...(localOwnersByBarcode.get(parsed.value) ?? []), item.id]);
  }
  for (const { externalId, asset, origins: sourceOrigins, batchMatchedItemId } of oneCRows) {
    const origins: AuditOneCOrigin[] = sourceOrigins ?? ["current_registry"];
    const matches = matchOneCFixedAssetIdentifiers(asset, { items: candidates, linkedItemId: linkByExternalId.get(externalId) });
    const ids = new Set([...matches.inventoryItemIds, ...matches.codeItemIds, ...matches.barcodeItemIds]);
    const linked = linkByExternalId.get(externalId);
    if (linked) ids.add(linked);
    if (origins.includes("selected_batch") && batchMatchedItemId) ids.add(batchMatchedItemId);
    const sourceBarcode = asset.barcode ? parseCode39ScanInput(asset.barcode) : { ok: false as const };
    if (sourceBarcode.ok) for (const id of localOwnersByBarcode.get(sourceBarcode.value) ?? []) ids.add(id);
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
        ...(batchMatchedItemId === id && !matches.inventoryItemIds.includes(id) && !matches.codeItemIds.includes(id) && !matches.barcodeItemIds.includes(id) && linked !== id && !matchedBarcodes.length ? ["batch_analysis" as const] : []),
      ];
      oneCByItem.set(id, [...(oneCByItem.get(id) ?? []), { externalId, code: asset.code, inventoryNumber: asset.inventoryNumber, barcode: asset.barcode, name: asset.name, status: asset.status ?? "", origins, matchedBy, matchedBarcodes }]);
    }
  }
  const counts: AuditCounts = { total: items.length, oneCOnly: 0, excelOnly: 0, both: 0, missing: 0, temporary: 0 };
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
    const excel = [...new Map<number, ExcelSourceRow>([...keys].flatMap(([key, evidence]) => (excelByNumber.get(key) ?? []).map((row): [number, ExcelSourceRow] => [row.rowNumber, {
      ...row, matchedBy: [
        ...(evidence.siteNumber ? ["site_number" as const] : []),
        ...(evidence.barcodes.length ? ["barcode" as const] : []),
      ], matchedBarcodes: evidence.barcodes,
    }]))).values()]
      .sort((a, b) => nameScore(item.name, b.nomenclature) - nameScore(item.name, a.nomenclature) || a.rowNumber - b.rowNumber);
    const oneC = (oneCByItem.get(item.id) ?? []).sort((a, b) => a.externalId.localeCompare(b.externalId) || a.origins.join().localeCompare(b.origins.join()));
    const source = oneC.length && excel.length ? "1c+excel" : oneC.length ? "1c" : excel.length ? "excel" : null;
    if (source === "1c+excel") counts.both++;
    else if (source === "1c") counts.oneCOnly++;
    else if (source === "excel") counts.excelOnly++;
    else counts.missing++;
    const temporary = item.inventoryNumberKind === "temporary" || /^TMP-/i.test(item.inventoryNumber);
    if (!source && temporary) counts.temporary++;
    return { itemId: item.id, itemName: item.name, siteNumber: item.inventoryNumber, siteBarcodes: [...item.officialBarcodes.map((value) => ({ value, kind: "official" as const })), ...(item.localBarcodes ?? []).map((value) => ({ value, kind: "local" as const }))], numberKind: item.inventoryNumberKind, itemVersion: item.version, result: source ? "matched" : temporary ? "temporary" : "missing", source, oneC, excel };
  }).sort((a, b) => a.itemId.localeCompare(b.itemId));
  return { rows, counts };
}
