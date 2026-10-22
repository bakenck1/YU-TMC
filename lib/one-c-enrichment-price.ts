import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import type { InventoryAuditEnrichmentItem, InventoryAuditEnrichmentPlan } from "@/lib/inventory-audit-enrichment";
import type { AuditMatch } from "@/lib/inventory-source-audit";

/** Exact cents within items.numeric(14,2); missing or excessive precision is never rounded. */
export function enrichmentMoney(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)))) return null;
  const text = String(value).trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/u.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}

/** Price uses the same identified source as the name/code; residual values never become a purchase price. */
export function addOneCPriceProposals(plan: InventoryAuditEnrichmentPlan, evidence: AuditMatch[], assets: Map<string, OneCFixedAsset>, items: InventoryAuditEnrichmentItem[]) {
  const byItem = new Map(items.map(item => [item.id, item]));
  const matches = new Map(evidence.map(row => [row.itemId, row]));
  for (const row of plan.rows) {
    const current = enrichmentMoney(byItem.get(row.itemId)?.unitPrice) ?? "0.00";
    row.price = { currentUnitPrice: current, nextUnitPrice: current, changed: false, status: "unconfirmed" };
    if (!row.eligible) continue;
    const match = matches.get(row.itemId);
    let claims: unknown[];
    if (row.nameSource === "1c") {
      const source = row.externalId ? assets.get(row.externalId) : undefined;
      row.price.source = "os_initial_cost";
      // An aggregate asset cost cannot safely be interpreted as a unit price.
      if (!source || source.quantity !== 1) { row.price.status = "ambiguous"; continue; }
      claims = [source.initialCost];
    } else if (row.nameSource === "materials_api") {
      row.price.source = "material_unit_price";
      claims = (match?.excel ?? []).filter(entry => entry.sourceKind === "materials_api").map(entry => entry.unitPrice);
    } else continue;
    if (!claims.length || claims.some(value => value == null || value === "")) { row.price.status = "missing"; continue; }
    const prices = claims.map(enrichmentMoney);
    if (prices.some(value => value === null)) { row.price.status = "invalid"; continue; }
    const distinct = [...new Set(prices)];
    if (distinct.length !== 1) { row.price.status = "ambiguous"; continue; }
    row.price.nextUnitPrice = distinct[0]!;
    row.price.changed = row.price.nextUnitPrice !== current;
    row.price.status = row.price.changed ? "ready" : "unchanged";
    if (!row.price.changed) continue;
    if (!row.changed) { plan.counts.unchanged--; plan.counts.ready++; }
    row.changed = true;
    row.reason = "confirmed";
  }
}
