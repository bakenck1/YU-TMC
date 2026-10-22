import assert from "node:assert/strict";
import test from "node:test";
import { enrichmentMoney, addOneCPriceProposals } from "../lib/one-c-enrichment-price";
import type { InventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import type { AuditMatch } from "../lib/inventory-source-audit";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";

function proposal(source: "1c" | "materials_api", claims: unknown[], quantity = 1) {
  const plan: InventoryAuditEnrichmentPlan = { rows: [{ itemId: "card", itemVersion: 1, currentName: "Name", currentCode: "Code", nextName: "Name", nextCode: "Code", eligible: true, changed: false, reason: "unchanged", nameSource: source, externalId: "asset" }], counts: { ready: 0, unchanged: 1, skipped: 0 } };
  const evidence = [{ itemId: "card", excel: claims.map(unitPrice => ({ sourceKind: "materials_api", unitPrice })) }] as AuditMatch[];
  const assets = new Map([["asset", { initialCost: claims[0], residualCost: 999, quantity } as OneCFixedAsset]]);
  addOneCPriceProposals(plan, evidence, assets, [{ id: "card", name: "Name", inventoryNumber: "1/1", oneCCode: "Code", version: 1, itemSection: "general", officialBarcodes: [], unitPrice: "100.00" }]);
  return plan;
}

test("money preserves exact cents and rejects missing, negative, excessive precision and overflow", () => {
  assert.equal(enrichmentMoney("00100.1"), "100.10");
  assert.equal(enrichmentMoney(0), "0.00");
  for (const value of [null, undefined, "", -1, "100.001", "1e4", "1000000000000", NaN, Infinity]) assert.equal(enrichmentMoney(value), null);
});
test("only explicit unanimous material unit prices are proposed", () => {
  const valid = proposal("materials_api", ["9100", "9100.00"]);
  assert.deepEqual(valid.counts, { ready: 1, unchanged: 0, skipped: 0 });
  assert.equal(valid.rows[0].price?.nextUnitPrice, "9100.00");
  assert.equal(proposal("materials_api", ["100.00"]).rows[0].price?.status, "unchanged");
  for (const [claims, status] of [[["9100", null], "missing"], [["9100", "9200"], "ambiguous"], [["9100.001"], "invalid"]] as const) {
    const plan = proposal("materials_api", [...claims]);
    assert.equal(plan.rows[0].price?.status, status);
    assert.equal(plan.rows[0].changed, false);
    assert.equal(plan.rows[0].price?.nextUnitPrice, "100.00");
  }
});
test("OS uses initial cost only for a single asset and never substitutes residual value", () => {
  assert.equal(proposal("1c", ["500"]).rows[0].price?.nextUnitPrice, "500.00");
  assert.equal(proposal("1c", [null]).rows[0].price?.status, "missing");
  assert.equal(proposal("1c", ["500"], 2).rows[0].price?.status, "ambiguous");
});
