import assert from "node:assert/strict";
import test from "node:test";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { buildInventorySourceAudit, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "../lib/one-c-enrichment-price";
import { classifyOneCAudit } from "../lib/one-c-analytics";
import { addOneCResponsibilityProposals } from "../lib/one-c-enrichment-responsibility";

const card = { id: "card", name: "Наш товар", inventoryNumber: "011-00134", inventoryNumberKind: "official", oneCCode: null as string | null, officialBarcodes: [] as string[], sourceCodes: [], version: 1, itemSection: "general", status: "active", unitPrice: "0" };
const asset: OneCFixedAsset = { externalId: "os", code: "000003966", name: "Процессор 3.1 инв№011-00134", inventoryNumber: "011 00134", barcode: null, quantity: 1, initialCost: null, residualCost: 0, status: "Снято с учёта", category: null, location: null, responsibleName: null, responsibleExternalId: null, acceptedAt: null, updatedAt: null };
const material: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "mp", rowNumber: 1, oneCCode: "MP-134", nomenclature: "Процессор №011-00134", inventoryNumber: "", explicitInventoryNumber: null, barcode: null, endingBalance: "1", unitPrice: "27440" };
const options = { descriptionBarcodes: true, formattedNumbers: true, exactNames: true, allowDescriptionIdentity: true, includeIt: true, allowSourceCode: true };
function review(item = card, os: OneCFixedAsset[] = [asset], mp: ExcelSourceRow[] = [material]) {
  const audit = buildInventorySourceAudit([item], os.map(asset => ({ externalId: asset.externalId, asset })), mp, [], options);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [item], options);
  addOneCPriceProposals(plan, audit.rows, new Map(os.map(asset => [asset.externalId, asset])), [item], { independentSources: true });
  return { plan, audit, row: plan.rows[0] };
}

test("missing OS initial cost does not hide the independently matched MP unit price", () => {
  const { row, plan } = review();
  assert.equal(row.nameSource, "1c");
  assert.equal(row.price?.source, "material_unit_price");
  assert.equal(row.price?.nextUnitPrice, "27440.00");
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
});

test("a code present in both registers can update the agreed price without choosing a name or code source", () => {
  const item = { ...card, oneCCode: asset.code };
  const { row, plan } = review(item, [asset], [{ ...material, oneCCode: asset.code }]);
  assert.equal(row.eligible, true);
  assert.equal(row.nextName, item.name);
  assert.equal(row.nextCode, item.oneCCode);
  assert.equal(row.price?.nextUnitPrice, "27440.00");
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
});

test("permanent cards can use an exact 1C code in either register", () => {
  for (const section of ["os", "mp"] as const) {
    const item = { ...card, inventoryNumber: "999/999", oneCCode: asset.code };
    const { row, audit } = review(item, section === "os" ? [{ ...asset, initialCost: 50000 }] : [], section === "mp" ? [{ ...material, oneCCode: asset.code }] : []);
    assert.equal(row.price?.status, "ready");
    assert.equal(row.price?.nextUnitPrice, section === "os" ? "50000.00" : "27440.00");
    assert.equal(classifyOneCAudit(audit.rows).get(item.id)?.category, section === "os" ? "fixedAssets" : "materials");
  }
});

test("a shared metadata code cannot authorize assigning one source's owner to several physical cards", () => {
  const cards = [card, { ...card, id: "second" }].map(item => ({ ...item, oneCCode: material.oneCCode! }));
  const audit = buildInventorySourceAudit(cards, [], [{ ...material, responsibleName: "Бауыржан Анесович" }], [], options);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, cards, options);
  addOneCResponsibilityProposals(plan, audit.rows, new Map(), [{ id: "owner", fullName: "Бауыржан Анесович", active: true, deleted: false, role: "employee" }], cards.map(item => ({ itemId: item.id, userId: null, name: null, pendingTransfer: false, unavailable: false })));
  assert.ok(plan.rows.every(row => row.identityMethod === "material_code" && !row.responsibility?.changed));
});

test("formatted barcodes and complete numbers in names recover prices in either register", () => {
  for (const section of ["os", "mp"] as const) for (const identifier of ["011 / 00134", "011*00134", "011.00134"]) {
    for (const item of [{ ...card, inventoryNumber: "TMP-1", inventoryNumberKind: "temporary", officialBarcodes: [identifier] }, { ...card, inventoryNumber: "TMP-1", inventoryNumberKind: "temporary", name: `Процессор №${identifier}` }]) {
      const { row } = review(item, section === "os" ? [{ ...asset, initialCost: 50000 }] : [], section === "mp" ? [material] : []);
      assert.equal(row.price?.nextUnitPrice, section === "os" ? "50000.00" : "27440.00");
    }
  }
});

test("only a unique complete name can supply a name-only price, with spacing ignored", () => {
  const item = { ...card, inventoryNumber: "TMP-1", inventoryNumberKind: "temporary", name: "  UNIQUE   printer  " };
  const mp = { ...material, nomenclature: "Unique printer", explicitInventoryNumber: null };
  const { row, audit } = review(item, [], [mp]);
  assert.equal(row.nextName, item.name);
  assert.equal(row.price?.nextUnitPrice, "27440.00");
  assert.equal(classifyOneCAudit(audit.rows).get(item.id)?.category, "materials");
  assert.equal(review(item, [], [mp, { ...mp, sourceKey: "other", rowNumber: 2, oneCCode: "different" }]).row.price?.changed, false);
  assert.equal(review({ ...item, name: "Unique printer XL" }, [], [mp]).row.price?.changed, false);
  assert.equal(review({ ...item, inventoryNumber: "999/999", inventoryNumberKind: "official" }, [], [{ ...mp, explicitInventoryNumber: "111/111", inventoryNumber: "111/111" }]).row.price?.changed, false);
});

test("a long source name does not prevent a confirmed price-only update", () => {
  const { row, audit } = review(card, [], [{ ...material, nomenclature: `${"Long name ".repeat(20)} №011-00134` }]);
  assert.equal(row.eligible, true, JSON.stringify({ row, audit }));
  assert.equal(row.nextName, card.name);
  assert.equal(row.nextCode, card.oneCCode);
  assert.equal(row.price?.nextUnitPrice, "27440.00");
});

test("conflicting source prices, absent costs and a neighbouring inventory number cannot supply a price", () => {
  assert.equal(review(card, [{ ...asset, initialCost: 100 }]).row.price?.status, "ambiguous");
  const absent = review(card, [asset], []).row;
  assert.equal(absent.price?.status, "missing");
  assert.equal(absent.price?.nextUnitPrice, "0.00");
  assert.equal(review(card, [asset], [{ ...material, nomenclature: "Монитор №011-00132" }]).row.price?.changed, false);
  assert.equal(review({ ...card, status: "decommissioned" }).row.price?.changed, false);
});

test("an aggregate OS amount does not hide the independently identified MP unit price", () => {
  assert.equal(review(card, [{ ...asset, quantity: 2, initialCost: 60000 }]).row.price?.nextUnitPrice, "27440.00");
  const duplicate = [{ ...asset, initialCost: 100 }, { ...asset, externalId: "os2", initialCost: 200 }];
  assert.equal(review(card, duplicate).row.price?.status, "ambiguous");
  const { row } = review({ ...card, oneCCode: asset.code }, [{ ...asset, initialCost: 27440 }], [{ ...material, oneCCode: asset.code }]);
  assert.equal(row.price?.nextUnitPrice, "27440.00");
  assert.equal(row.nextName, card.name);
});

test("unique OS names and MP codes with outer spaces are recognized without trimming any digits", () => {
  const item = { ...card, name: "Unique device", inventoryNumber: "TMP-1", inventoryNumberKind: "temporary" };
  assert.equal(review(item, [{ ...asset, name: "UNIQUE  device", inventoryNumber: null, initialCost: 1000 }], []).row.price?.nextUnitPrice, "1000.00");
  const mp = { ...material, nomenclature: "Product", oneCCode: "0000123" };
  assert.equal(review({ ...card, oneCCode: " 0000123 ", inventoryNumber: "999/999" }, [], [mp]).row.price?.nextUnitPrice, "27440.00");
  assert.equal(review({ ...card, oneCCode: "123", inventoryNumber: "999/999" }, [], [mp]).row.price?.changed, false);
});

test("price recovery cannot revive stale cards, and all balances of the selected code still constrain price", () => {
  const audit = buildInventorySourceAudit([card], [], [material], [], options);
  const stale = { ...card, version: 2 };
  const stalePlan = buildInventoryAuditEnrichmentPlan(audit.rows, [stale], options);
  addOneCPriceProposals(stalePlan, audit.rows, new Map(), [stale], { independentSources: true });
  assert.equal(stalePlan.rows[0].eligible, false);
  assert.equal(stalePlan.rows[0].reason, "item_changed");
  const evidence = [{ ...audit.rows[0], excel: [...audit.rows[0].excel, { ...material, rowNumber: 2, sourceKey: "balance", unitPrice: "999" }] }];
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [card], options);
  addOneCPriceProposals(plan, evidence, new Map(), [card], { independentSources: true });
  assert.equal(plan.rows[0].price?.status, "ambiguous");
});
