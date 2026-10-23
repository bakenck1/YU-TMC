import { extractExcelInventoryReferences, extractFormattedInventoryReferences, inventoryAuditFormattedKey, inventoryAuditRange } from "@/lib/inventory-audit-numbers";

/** A single complete name number labels an item whose stored number is temporary or absent. */
export function inventoryNumberLabel(item: { inventoryNumber: string; name: string; localGroupId?: string }): string | null {
  const saved = item.inventoryNumber.trim();
  if (item.localGroupId || saved && saved !== '-' && !/^(?:TMP-|YUI-)/iu.test(saved)) return saved || null;
  const references = [...extractExcelInventoryReferences(item.name), ...extractFormattedInventoryReferences(item.name)];
  const numbers = new Map<string, string>();
  for (const ref of references) {
    const candidate = (ref.sourceInventoryNumber ?? ref.inventoryNumber).trim();
    // An unmarked full slash number is an inventory identity; plain model digits are not.
    if (ref.numberIsUnmarked && !/^\d{2,}\s*\/\s*\d{3,}$/u.test(candidate)) continue;
    if (inventoryAuditRange(candidate) || /^\d+[/-]\d+-\d+$/u.test(candidate)) return saved || null;
    const key = inventoryAuditFormattedKey(candidate);
    if (key) numbers.set(key, candidate);
  }
  return numbers.size === 1 ? [...numbers.values()][0] : saved || null;
}
