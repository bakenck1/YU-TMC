import assert from "node:assert/strict";
import test from "node:test";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { buildInventorySourceAudit, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "../lib/one-c-enrichment-price";
import { addOneCResponsibilityProposals } from "../lib/one-c-enrichment-responsibility";

const item = { id: "temporary", name: "Стол", inventoryNumber: "TMP-2026-123456", inventoryNumberKind: "temporary", oneCCode: null, responsibleName: "Иванов Иван Иванович", officialBarcodes: [], sourceCodes: [], version: 1, itemSection: "general", status: "active", unitPrice: "0" };
const material: ExcelSourceRow = { rowNumber: 1, sourceKind: "materials_api", sourceKey: "balance-1", materialGuid: "material", nomenclature: "СТОЛ", inventoryNumber: "", oneCCode: "00000123", endingBalance: "1", unitPrice: "100", responsibleName: item.responsibleName };
const asset: OneCFixedAsset = { externalId: "os", name: "СТОЛ", code: "00000001", inventoryNumber: null, barcode: null, category: null, location: null, status: "Не в учёте", responsibleName: item.responsibleName, responsibleExternalId: null, quantity: 1, initialCost: 500, residualCost: 50, acceptedAt: null, updatedAt: null };
const options = { exactNames: true, formattedNumbers: true, descriptionBarcodes: true, allowDescriptionIdentity: true, allowSourceCode: true, includeIt: true };
function review(materials: ExcelSourceRow[], assets: OneCFixedAsset[] = []) {
  const evidence = buildInventorySourceAudit([item], assets.map(source => ({ externalId: source.externalId, asset: source })), materials, [], options).rows;
  const plan = buildInventoryAuditEnrichmentPlan(evidence, [item], options);
  return { evidence, plan, prices: () => addOneCPriceProposals(plan, evidence, new Map(assets.map(source => [source.externalId, source])), [item], { independentSources: true }) };
}

test("name/owner price comes from the globally selected register, including code and source spelling", () => {
  const { plan, prices } = review([material], [asset]);
  prices();
  assert.equal(plan.rows[0].identityMethod, "name_owner");
  assert.equal(plan.rows[0].nextCode, material.oneCCode);
  assert.equal(plan.rows[0].nextName, material.nomenclature);
  assert.equal(plan.rows[0].price?.nextUnitPrice, "100.00");
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
});

test("another owner's balance with the same code cannot replace the selected owner's price", () => {
  const { evidence, plan, prices } = review([material]);
  evidence[0].excel.push({ ...material, rowNumber: 2, sourceKey: "other-owner", responsibleName: "Петров Петр Петрович", unitPrice: "900" });
  prices();
  assert.equal(plan.rows[0].price?.status, "ready");
  assert.equal(plan.rows[0].price?.nextUnitPrice, "100.00");
});

test("conflicting prices in the same selected owner's balances preserve the current price", () => {
  const { plan, prices } = review([material, { ...material, rowNumber: 2, sourceKey: "balance-2", unitPrice: "900" }]);
  prices();
  assert.equal(plan.rows[0].nextCode, material.oneCCode);
  assert.equal(plan.rows[0].price?.status, "ambiguous");
  assert.equal(plan.rows[0].price?.nextUnitPrice, "0.00");
});

test("name/owner identification never proposes reassigning the existing responsible person", () => {
  const { evidence, plan } = review([material]);
  addOneCResponsibilityProposals(plan, evidence, new Map(), [], [{ itemId: item.id, userId: "current", name: item.responsibleName, pendingTransfer: false, unavailable: false }]);
  assert.equal(plan.rows[0].responsibility?.changed, false);
  assert.equal(plan.rows[0].responsibility?.nextUserId, "current");
});
