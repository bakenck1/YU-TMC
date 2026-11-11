import assert from "node:assert/strict";
import test from "node:test";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { buildInventorySourceAudit } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem } from "../lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "../lib/one-c-enrichment-price";

const card: InventoryAuditEnrichmentItem = {
  id: "card", name: "Наш ноутбук", inventoryNumber: "1350/00134", oneCCode: null,
  version: 1, officialBarcodes: [], itemSection: "general", status: "decommissioned",
  archivedAt: new Date("2026-10-01T00:00:00Z"), unitPrice: "100.00",
};
const asset: OneCFixedAsset = {
  externalId: "os", code: "000003966", name: "Ноутбук Lenovo №1350/00134",
  inventoryNumber: "1350/00134", barcode: null, quantity: 1, initialCost: 50000,
  residualCost: 0, status: "Снято с учёта", category: null, location: null,
  responsibleName: null, responsibleExternalId: null, acceptedAt: null, updatedAt: null,
};

function review(item = card, decommissionedOnly = true, sources = [asset]) {
  const options = { descriptionBarcodes: true, formattedNumbers: true, exactNames: true, allowDescriptionIdentity: true, includeIt: true, allowSourceCode: true, decommissionedOnly };
  const audit = buildInventorySourceAudit([{ ...item, officialBarcodes: [...item.officialBarcodes], localBarcodes: [...(item.localBarcodes ?? [])], inventoryNumberKind: "official", sourceCodes: [] }], sources.map(asset => ({ externalId: asset.externalId, asset, origins: ["current_registry" as const] })), [], [], options);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [item], options);
  addOneCPriceProposals(plan, audit.rows, new Map(sources.map(asset => [asset.externalId, asset])), [item], { independentSources: true, decommissionedOnly });
  return plan;
}

test("archived written-off cards use the existing complete identifier matching and original unit cost", () => {
  for (const status of ["decommissioned", "decommissioned_in_use"]) {
    const plan = review({ ...card, status });
    assert.equal(plan.rows[0].nextName, asset.name);
    assert.equal(plan.rows[0].price?.nextUnitPrice, "50000.00");
    assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
    assert.equal(review({ ...card, status }, false).rows[0].eligible, false);
  }
});

test("written-off scope cannot revive active, maintenance or IT cards through independent price matching", () => {
  for (const item of [
    { ...card, status: "active", archivedAt: null },
    { ...card, status: "maintenance", archivedAt: null },
    { ...card, itemSection: "it" },
  ]) {
    const plan = review(item);
    assert.equal(plan.rows[0].reason, "item_ineligible");
    assert.equal(plan.rows[0].price?.changed, false);
    assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
  }
});

test("independent prices recover unanimous saved-code evidence for archived cards without choosing an ambiguous name", () => {
  const item = { ...card, oneCCode: asset.code };
  const plan = review(item, true, [asset, { ...asset, externalId: "other", name: "Другое название" }]);
  assert.equal(plan.rows[0].nextName, item.name);
  assert.equal(plan.rows[0].price?.nextUnitPrice, "50000.00");
  assert.equal(plan.rows[0].changed, true);
});

test("written-off search never matches an identifier fragment and never replaces a price with historical zero", () => {
  const missing = review(card, true, [{ ...asset, inventoryNumber: "1350/001340", name: "Ноутбук №1350/001340" }]);
  assert.equal(missing.counts.ready, 0);
  const zero = review(card, true, [{ ...asset, initialCost: 0 }]);
  assert.equal(zero.rows[0].price?.changed, false);
  assert.equal(zero.rows[0].price?.nextUnitPrice, "100.00");
});
