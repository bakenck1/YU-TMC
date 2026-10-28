import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem, type InventoryAuditEnrichmentPlan } from "@/lib/inventory-audit-enrichment";
import type { AuditMatch } from "@/lib/inventory-source-audit";
import { exactMaterialCode } from "@/lib/one-c-material-code";
import { classifyOneCAudit } from "@/lib/one-c-analytics";
import { oneCNameOwnerCanIdentify } from "@/lib/one-c-source-name";

/** Exact cents within items.numeric(14,2); missing or excessive precision is never rounded. */
export function enrichmentMoney(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)))) return null;
  const text = String(value).trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/u.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}

/** Live prices can use either independently identified register; residual values never become a purchase price. */
export function addOneCPriceProposals(plan: InventoryAuditEnrichmentPlan, evidence: AuditMatch[], assets: Map<string, OneCFixedAsset>, items: InventoryAuditEnrichmentItem[], options: { independentSources?: boolean } = {}) {
  if (options.independentSources) {
    addIndependentPrices(plan, evidence, assets, items);
    return;
  }
  const byItem = new Map(items.map(item => [item.id, item]));
  const matches = new Map(evidence.map(row => [row.itemId, row]));
  for (const row of plan.rows) {
    const current = enrichmentMoney(byItem.get(row.itemId)?.unitPrice) ?? "0.00";
    row.price = { currentUnitPrice: current, nextUnitPrice: current, changed: false, status: "unconfirmed" };
    if (!row.eligible) continue;
    const match = matches.get(row.itemId);
    const item = byItem.get(row.itemId);
    const ownerIdentity = row.identityMethod === "name_owner";
    const ownsSource = (name: string, responsibleName?: string | null) => Boolean(item && match
      && oneCNameOwnerCanIdentify({ ...item, inventoryNumberKind: match.numberKind }, name, responsibleName));
    let claims: unknown[];
    if (row.nameSource === "1c") {
      const source = row.externalId ? assets.get(row.externalId) : undefined;
      if (ownerIdentity && (!source || !ownsSource(source.name, source.responsibleName))) continue;
      row.price.source = "os_initial_cost";
      row.price.sourceExternalId = source?.externalId;
      // An aggregate asset cost cannot safely be interpreted as a unit price.
      if (!source || source.quantity !== 1) { row.price.status = "ambiguous"; continue; }
      claims = [source.initialCost];
    } else if (row.nameSource === "materials_api") {
      row.price.source = "material_unit_price";
      const selected = match?.excel.find(entry => entry.rowNumber === row.excelRowNumber);
      if (ownerIdentity && (!selected || !ownsSource(selected.nomenclature, selected.responsibleName))) continue;
      const selectedCode = exactMaterialCode(selected?.oneCCode);
      row.price.sourceMaterialCode = selectedCode;
      claims = (match?.excel ?? []).filter(entry => entry.sourceKind === "materials_api"
        && (!ownerIdentity || entry.materialGuid === selected?.materialGuid && ownsSource(entry.nomenclature, entry.responsibleName))
        && (selectedCode !== null ? exactMaterialCode(entry.oneCCode) === selectedCode
          : row.identityMethod !== "material_code" || exactMaterialCode(entry.oneCCode) === exactMaterialCode(row.nextCode))).map(entry => entry.unitPrice);
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

/** Missing OS cost must not hide an independently identified MP unit price. */
function addIndependentPrices(plan: InventoryAuditEnrichmentPlan, evidence: AuditMatch[], assets: Map<string, OneCFixedAsset>, items: InventoryAuditEnrichmentItem[]) {
  const matching = { allowDescriptionIdentity: true, includeIt: true, formattedNumbers: true, allowSourceCode: true, priceOnly: true };
  const osEvidence = evidence.map(row => ({ ...row, excel: [] }));
  const mpEvidence = evidence.map(row => ({ ...row, oneC: [], excel: row.excel.filter(entry => entry.matchedBy?.length) }));
  const osPlan = buildInventoryAuditEnrichmentPlan(osEvidence, items, matching);
  const mpPlan = buildInventoryAuditEnrichmentPlan(mpEvidence, items, matching);
  addOneCPriceProposals(osPlan, osEvidence, assets, items);
  addOneCPriceProposals(mpPlan, evidence, assets, items);
  // Several OS GUIDs may share the saved nomenclature code. A unanimous known
  // unit cost can update price alone without choosing an arbitrary name/GUID.
  const savedItems = new Map(items.map(item => [item.id, item]));
  for (const row of osPlan.rows) {
    if (row.reason !== "source_ambiguous") continue;
    const code = exactMaterialCode(savedItems.get(row.itemId)?.oneCCode);
    const matches = osEvidence.filter(entry => entry.itemId === row.itemId);
    if (matches.length !== 1) continue;
    const match = matches[0];
    if (!code || exactMaterialCode(match?.siteOneCCode) !== code) continue;
    const sources = (match?.oneC ?? []).filter(entry => exactMaterialCode(entry.code) === code
      && entry.origins.includes("current_registry"))
      .map(entry => assets.get(entry.externalId)).filter((asset): asset is OneCFixedAsset => Boolean(asset && asset.quantity === 1 && exactMaterialCode(asset.code) === code));
    const known = sources.filter(asset => asset.initialCost != null);
    const costs = known.map(asset => enrichmentMoney(asset.initialCost));
    if (!known.length || costs.some(cost => cost === null) || new Set(costs).size !== 1) continue;
    const current = enrichmentMoney(savedItems.get(row.itemId)?.unitPrice) ?? "0.00";
    row.eligible = true;
    row.nextName = row.currentName;
    row.nextCode = row.currentCode;
    row.price = { currentUnitPrice: current, nextUnitPrice: costs[0]!, changed: current !== costs[0],
      status: current !== costs[0] ? "ready" : "unchanged", source: "os_initial_cost",
      sourceExternalId: known.map(asset => asset.externalId).sort()[0] };
  }
  const os = new Map(osPlan.rows.map(row => [row.itemId, row]));
  const mp = new Map(mpPlan.rows.map(row => [row.itemId, row]));
  const byItem = new Map(items.map(item => [item.id, item]));
  const byEvidence = new Map(evidence.map(row => [row.itemId, row]));
  // Keep the globally chosen source for name/owner matches, rather than choosing
  // an independent price source from each register. Process them in one batch.
  addOneCPriceProposals({ rows: plan.rows.filter(row => row.identityMethod === "name_owner"), counts: plan.counts }, evidence, assets, items);
  for (const row of plan.rows) {
    if (row.identityMethod === "name_owner") continue;
    const current = enrichmentMoney(byItem.get(row.itemId)?.unitPrice) ?? "0.00";
    row.price = { currentUnitPrice: current, nextUnitPrice: current, changed: false, status: "unconfirmed" };
    // Never revive stale, inactive, or identity-trigger-rejected cards.
    if (!row.eligible && !["source_ambiguous", "source_reused", "identity_missing", "identity_conflict", "name_invalid"].includes(row.reason)) continue;
    const candidates = [os.get(row.itemId), mp.get(row.itemId)].filter(candidate => candidate?.eligible);
    const prices = candidates.flatMap(candidate => candidate?.price ? [candidate.price] : []);
    const ready = prices.filter(price => price.status === "ready" || price.status === "unchanged");
    const values = new Set(ready.map(price => price.nextUnitPrice));
    const match = byEvidence.get(row.itemId);
    const conflictingOs = !os.get(row.itemId)?.eligible && os.get(row.itemId)?.reason === "source_ambiguous" && match?.oneC.some(entry => {
      const asset = assets.get(entry.externalId);
      return asset?.quantity === 1 && enrichmentMoney(asset.initialCost) !== null
        && classifyOneCAudit([{ ...match, oneC: [entry], excel: [] }]).get(row.itemId)?.fixedAssets;
    });
    const conflictingMp = mp.get(row.itemId)?.reason === "source_ambiguous" && match?.excel.some(entry => enrichmentMoney(entry.unitPrice) !== null
      && classifyOneCAudit([{ ...match, oneC: [], excel: [entry] }]).get(row.itemId)?.materials);
    if (values.size > 1 || conflictingOs || conflictingMp || prices.some(price => price.status === "ambiguous" && price.source === "material_unit_price")) { row.price.status = "ambiguous"; continue; }
    if (prices.some(price => price.status === "invalid")) { row.price.status = "invalid"; continue; }
    if (!ready.length) { if (prices.length) row.price.status = prices.some(price => price.status === "ambiguous") ? "ambiguous" : "missing"; continue; }
    row.price = { ...ready[0], currentUnitPrice: current, changed: ready[0].nextUnitPrice !== current };
    row.price.status = row.price.changed ? "ready" : "unchanged";
    if (!row.price.changed) continue;
    if (!row.eligible) {
      // Source selection for names/codes may be ambiguous while the price is not.
      plan.counts.skipped--;
      plan.counts.ready++;
      row.nextName = row.currentName;
      row.nextCode = row.currentCode;
      row.eligible = true;
    } else if (!row.changed) { plan.counts.unchanged--; plan.counts.ready++; }
    row.changed = true;
    row.reason = "confirmed";
  }
}
