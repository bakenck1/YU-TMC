import { parseCode39ScanInput } from "@/lib/domain/code39";
import { inventoryAuditItemNameNumbers, inventoryAuditNumbersEqual } from "@/lib/inventory-audit-numbers";
import { exactMaterialCode } from "@/lib/one-c-material-code";
import { oneCResponsibleNameKey } from "@/lib/one-c-responsible-name";
export { oneCResponsibleNameKey } from "@/lib/one-c-responsible-name";

/** Full-name equality only: preserve punctuation and every digit, ignore casing/spacing. */
export function oneCSourceNameKey(value: string): string | null {
  const key = value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/\s/gu, "");
  return key || null;
}

/** Temporary cards without a saved source code may use full item name AND full owner name. */
export function oneCNameOwnerCanIdentify(item: { name: string; inventoryNumber: string; inventoryNumberKind?: string; responsibleName?: string | null; oneCCode?: string | null }, sourceName: string, sourceResponsibleName?: string | null): boolean {
  if (exactMaterialCode(item.oneCCode) || !(item.inventoryNumberKind === "temporary" || /^TMP-/iu.test(item.inventoryNumber))) return false;
  const name = oneCSourceNameKey(item.name);
  const owner = oneCResponsibleNameKey(item.responsibleName);
  return Boolean(name && owner && name === oneCSourceNameKey(sourceName) && owner === oneCResponsibleNameKey(sourceResponsibleName));
}

export type OneCNameOwnerSourcePriority = { active: boolean; unitPrice?: string | number | null; code?: string | null; guid?: string | null; key?: string | null };

/** Stable choice among already verified name+owner identities, independent of input order. */
export function selectOneCNameOwnerSource<T>(sources: readonly T[], evidence: (source: T) => OneCNameOwnerSourcePriority): T | undefined {
  const validPrice = (value: OneCNameOwnerSourcePriority["unitPrice"]) => {
    if (typeof value !== "number" && typeof value !== "string") return false;
    if (!/^\d{1,12}(?:\.\d{1,2})?$/u.test(String(value).trim())) return false;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && Number.isSafeInteger(Math.round(number * 100));
  };
  const lexical = (left: string | null | undefined, right: string | null | undefined) => {
    const a = left ?? "", b = right ?? "";
    return a < b ? -1 : a > b ? 1 : 0;
  };
  return [...sources].sort((left, right) => {
    const a = evidence(left), b = evidence(right);
    return Number(b.active) - Number(a.active)
      || Number(validPrice(b.unitPrice)) - Number(validPrice(a.unitPrice))
      || Number(Boolean(b.code?.trim())) - Number(Boolean(a.code?.trim()))
      || lexical(a.code, b.code) || lexical(a.guid, b.guid) || lexical(a.key, b.key);
  })[0];
}


/** A matching name is useful only alongside a matching identifier, never by itself. */
export function oneCNameCanIdentify(item: { name: string; inventoryNumber: string; officialBarcodes: readonly string[]; localBarcodes?: readonly string[] }, sourceName: string, sourceNumber?: string | null, sourceBarcode?: string | null): boolean {
  if (!oneCSourceNameKey(item.name) || oneCSourceNameKey(item.name) !== oneCSourceNameKey(sourceName)) return false;
  const decode = (value: string | null | undefined) => {
    if (!value) return null;
    const parsed = parseCode39ScanInput(value);
    const result = parsed.ok ? parsed.fallbackKey ? null : parsed.inventoryNumber : value;
    return result && !/^(?:TMP-|YUI-)/iu.test(result) ? result : null;
  };
  const anchors = [item.inventoryNumber, ...item.officialBarcodes, ...(item.localBarcodes ?? []), ...inventoryAuditItemNameNumbers(item.name)].map(decode).filter((value): value is string => Boolean(value));
  const claims = [sourceNumber, sourceBarcode, ...inventoryAuditItemNameNumbers(sourceName)].map(decode).filter((value): value is string => Boolean(value));
  return anchors.length > 0 && claims.length > 0
    && claims.every(claim => anchors.some(anchor => inventoryAuditNumbersEqual(anchor, claim)));
}
