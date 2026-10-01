import { inventoryNumberComparisonKey, parseCode39ScanInput } from "@/lib/domain/code39";
import { matchOneCFixedAssetIdentifiers } from "@/lib/one-c-reconciliation";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";

export type ExcelSourceRow = { rowNumber: number; nomenclature: string; inventoryNumber: string; endingBalance: string | null };
export type AuditItem = { id: string; name: string; inventoryNumber: string; inventoryNumberKind: string; oneCCode: string | null; officialBarcodes: string[]; sourceCodes: string[]; version: number };
export type AuditOneCRow = { externalId: string; asset: OneCFixedAsset };
export type AuditMatch = { itemId: string; itemName: string; siteNumber: string; numberKind: string; itemVersion: number; result: "matched" | "missing" | "temporary"; source: "1c" | "excel" | "1c+excel" | null; oneC: { externalId: string; code: string | null; inventoryNumber: string | null; name: string; status: string }[]; excel: ExcelSourceRow[] };
export type AuditCounts = { total: number; oneCOnly: number; excelOnly: number; both: number; missing: number; temporary: number };

/** Extracts only the first marked number. A slash-prefix range has one searchable number. */
export function extractExcelInventoryNumber(value: string): string | null {
  const marker = /№\s*([0-9]+(?:\s*[/-]\s*[0-9]+)*(?:\s+[0-9]+(?![0-9.]))*)/u.exec(value);
  if (!marker) return null;
  let number = marker[1].normalize("NFKC").trim();
  if (/\d\s*\/\s*\d+\s*-\s*\d+$/u.test(number)) number = number.replace(/\s*-\s*\d+$/u, "");
  return number || null;
}

function officialBarcodeNumber(value: string): string | null {
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
  for (const { externalId, asset } of oneCRows) {
    const matches = matchOneCFixedAssetIdentifiers(asset, { items: candidates, linkedItemId: linkByExternalId.get(externalId) });
    const ids = new Set([...matches.inventoryItemIds, ...matches.codeItemIds, ...matches.barcodeItemIds]);
    const linked = linkByExternalId.get(externalId);
    if (linked) ids.add(linked);
    for (const id of ids) oneCByItem.set(id, [...(oneCByItem.get(id) ?? []), { externalId, code: asset.code, inventoryNumber: asset.inventoryNumber, name: asset.name, status: asset.status ?? "" }]);
  }
  const counts: AuditCounts = { total: items.length, oneCOnly: 0, excelOnly: 0, both: 0, missing: 0, temporary: 0 };
  const rows = items.map((item): AuditMatch => {
    const keys = new Set<string>();
    if (item.inventoryNumber) keys.add(inventoryNumberComparisonKey(item.inventoryNumber));
    for (const barcode of item.officialBarcodes) {
      const number = officialBarcodeNumber(barcode);
      if (number) keys.add(inventoryNumberComparisonKey(number));
    }
    const excel = [...new Map([...keys].flatMap((key) => excelByNumber.get(key) ?? []).map((row) => [row.rowNumber, row])).values()]
      .sort((a, b) => nameScore(item.name, b.nomenclature) - nameScore(item.name, a.nomenclature) || a.rowNumber - b.rowNumber);
    const oneC = (oneCByItem.get(item.id) ?? []).sort((a, b) => a.externalId.localeCompare(b.externalId));
    const source = oneC.length && excel.length ? "1c+excel" : oneC.length ? "1c" : excel.length ? "excel" : null;
    if (source === "1c+excel") counts.both++;
    else if (source === "1c") counts.oneCOnly++;
    else if (source === "excel") counts.excelOnly++;
    else counts.missing++;
    const temporary = item.inventoryNumberKind === "temporary" || /^TMP-/i.test(item.inventoryNumber);
    if (!source && temporary) counts.temporary++;
    return { itemId: item.id, itemName: item.name, siteNumber: item.inventoryNumber, numberKind: item.inventoryNumberKind, itemVersion: item.version, result: source ? "matched" : temporary ? "temporary" : "missing", source, oneC, excel };
  }).sort((a, b) => a.itemId.localeCompare(b.itemId));
  return { rows, counts };
}
