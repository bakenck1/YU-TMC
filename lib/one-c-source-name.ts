import { parseCode39ScanInput } from "@/lib/domain/code39";
import { inventoryAuditItemNameNumbers, inventoryAuditNumbersEqual } from "@/lib/inventory-audit-numbers";

/** Full-name equality only: preserve punctuation and every digit, ignore casing/spacing. */
export function oneCSourceNameKey(value: string): string | null {
  const key = value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/\s/gu, "");
  return key || null;
}


/** Equal names cannot override a known, different inventory number or barcode. */
export function oneCNameCanIdentify(item: { name: string; inventoryNumber: string; officialBarcodes: readonly string[]; localBarcodes?: readonly string[] }, sourceName: string, sourceNumber?: string | null, sourceBarcode?: string | null): boolean {
  if (!oneCSourceNameKey(item.name) || oneCSourceNameKey(item.name) !== oneCSourceNameKey(sourceName)) return false;
  const decode = (value: string | null | undefined) => {
    if (!value) return null;
    const parsed = parseCode39ScanInput(value);
    const result = parsed.ok ? parsed.fallbackKey ? null : parsed.inventoryNumber : value;
    return result && !/^(?:TMP-|YUI-)/iu.test(result) ? result : null;
  };
  const anchors = [item.inventoryNumber, ...item.officialBarcodes, ...(item.localBarcodes ?? []), ...inventoryAuditItemNameNumbers(item.name)].map(decode).filter((value): value is string => Boolean(value));
  const claims = [sourceNumber, sourceBarcode].map(decode).filter((value): value is string => Boolean(value));
  return !anchors.length || claims.every(claim => anchors.some(anchor => inventoryAuditNumbersEqual(anchor, claim)));
}
