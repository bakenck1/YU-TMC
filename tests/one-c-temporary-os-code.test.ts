import assert from "node:assert/strict";
import test from "node:test";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { buildInventorySourceAudit, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "../lib/one-c-enrichment-price";
import { classifyOneCAudit, summarizeOneCAudit } from "../lib/one-c-analytics";

const options = { formattedNumbers: true, descriptionBarcodes: true, allowDescriptionIdentity: true, allowTemporaryMaterialCode: true, allowTemporaryAssetCode: true };
const card = (id: string, code: string) => ({ id, name: `Наш ${id}`, inventoryNumber: `TMP-${id}`, inventoryNumberKind: "temporary", oneCCode: code, officialBarcodes: [], sourceCodes: [], version: 1, itemSection: "general", status: "active", unitPrice: "0" });
const asset: OneCFixedAsset = { externalId: "os", code: "00000123", name: "Название ОС", inventoryNumber: null, barcode: null, quantity: 1, initialCost: 50000, residualCost: 1000, category: null, location: null, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null, acceptedAt: null, updatedAt: null };
const mp: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "mp", rowNumber: 1, oneCCode: "00000456", nomenclature: "Название МП", inventoryNumber: "", explicitInventoryNumber: null, barcode: null, endingBalance: "2", unitPrice: "1234" };

test("all temporary cards are checked against both registers and placed in their own categories", () => {
  const items = [card("asset", asset.code!), card("material", mp.oneCCode!), card("missing", "999")];
  const audit = buildInventorySourceAudit(items, [{ externalId: "os", asset }], [mp], [], options);
  const presence = classifyOneCAudit(audit.rows);
  assert.equal(presence.get("asset")?.category, "fixedAssets");
  assert.equal(presence.get("material")?.category, "materials");
  assert.equal(presence.get("missing")?.category, "missing");
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, items, options);
  addOneCPriceProposals(plan, audit.rows, new Map([["os", asset]]), items);
  assert.equal(plan.rows.find(row => row.itemId === "asset")?.identityMethod, "asset_code");
  assert.equal(plan.rows.find(row => row.itemId === "asset")?.nextName, asset.name);
  assert.equal(plan.rows.find(row => row.itemId === "asset")?.price?.nextUnitPrice, "50000.00");
  assert.equal(plan.rows.find(row => row.itemId === "material")?.price?.nextUnitPrice, "1234.00");
  const counts = summarizeOneCAudit(audit.rows, ["os"], ["mp"]);
  assert.equal(counts.fixedAssets, 1); assert.equal(counts.materials, 1); assert.equal(counts.temporaryUnmatched, 1);
});

test("code found in both sections is counted once and conflicting sources do not silently overwrite a card", () => {
  const item = card("both", asset.code!);
  const audit = buildInventorySourceAudit([item], [{ externalId: "os", asset }], [{ ...mp, oneCCode: asset.code }], [], options);
  assert.equal(classifyOneCAudit(audit.rows).get("both")?.category, "both");
  assert.equal(summarizeOneCAudit(audit.rows, ["os"], ["mp"]).both, 1);
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, [item], options).rows[0].reason, "source_ambiguous");
});

test("OS code retains zeros, and multiple OS records sharing a code require review", () => {
  const items = [card("wrong", "123"), card("right", asset.code!)];
  const audit = buildInventorySourceAudit(items, [{ externalId: "os", asset }, { externalId: "os2", asset: { ...asset, externalId: "os2", name: "Другая ОС" } }], [], [], options);
  assert.equal(classifyOneCAudit(audit.rows).get("wrong")?.category, "missing");
  assert.equal(classifyOneCAudit(audit.rows).get("right")?.category, "fixedAssets");
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, items, options).rows.find(row => row.itemId === "right")?.reason, "source_ambiguous");
});

test("OS code match cannot invent initial cost from residual cost", () => {
  const item = card("os", asset.code!);
  const source = { ...asset, initialCost: null };
  const audit = buildInventorySourceAudit([item], [{ externalId: "os", asset: source }], [], [], options);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [item], options);
  addOneCPriceProposals(plan, audit.rows, new Map([["os", source]]), [item]);
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].price?.status, "missing");
  assert.equal(plan.rows[0].price?.nextUnitPrice, "0.00");
});
