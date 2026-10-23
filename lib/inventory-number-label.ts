import { extractFormattedInventoryReferences, inventoryAuditFormattedKey, inventoryAuditRange } from "@/lib/inventory-audit-numbers";

/** Display only: a clear number in a name may replace a temporary list label. */
export function inventoryNumberLabel(item: { inventoryNumber: string; name: string; localGroupId?: string }): string | null {
  const saved = item.inventoryNumber.trim();
  if (item.localGroupId || !/^(?:TMP-|YUI-)/iu.test(saved)) return saved || null;
  const references = extractFormattedInventoryReferences(item.name).filter(ref => !ref.numberIsUnmarked);
  const numbers = new Map(references.map(ref => [inventoryAuditFormattedKey(ref.inventoryNumber), ref.inventoryNumber]));
  if (numbers.size !== 1) return saved;
  const candidate = [...numbers.values()][0];
  // A group range cannot identify one physical card.
  return inventoryAuditRange(candidate) || /^\d+[/-]\d+-\d+$/u.test(candidate) ? saved : candidate;
}
