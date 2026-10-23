import assert from "node:assert/strict";
import test from "node:test";
import { buildInventorySourceAudit, type AuditItem, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "../lib/one-c-enrichment-price";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { classifyOneCAudit } from "../lib/one-c-analytics";

const options = { descriptionBarcodes: true, formattedNumbers: true, allowDescriptionIdentity: true, includeIt: true };
const card: AuditItem & { itemSection: string; unitPrice: string; status: string } = { id: "cabinet", name: "шкаф-купе д/документов No1350/16355 от 09.10.2024", inventoryNumber: "1350/16355", inventoryNumberKind: "official", oneCCode: null, officialBarcodes: [], sourceCodes: [], version: 1, itemSection: "general", unitPrice: "0", status: "active" };
const material: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "mp", rowNumber: 1, oneCCode: "00000013205", nomenclature: "шкаф-купе д/документов №1350/16355 от 09.10.2024", inventoryNumber: "", explicitInventoryNumber: null, barcode: null, endingBalance: "1", unitPrice: "86955" };
const os: OneCFixedAsset = { externalId: "os", name: "Шкаф №1350/16355", inventoryNumber: null, barcode: null, code: "00000013205", quantity: 1, initialCost: 86955, residualCost: 12000, status: "Принято к учёту", category: null, location: null, responsibleName: null, responsibleExternalId: null, acceptedAt: null, updatedAt: null };

for (const section of ["os", "mp"] as const) {
  for (const identifier of ["1350/16355", "1350-16355", "1350.16355", "13 50 / 16 355", "1350*16355", "1350_16355", "1350:16355", "1350\\16355", "1350—16355"]) {
    test(`${section}: code and price follow a full number in the site name: ${identifier}`, () => {
      const item = { ...card, inventoryNumber: "TMP-2026-000001", inventoryNumberKind: "temporary", name: `Шкаф инв. №${identifier} от 09.10.2024` };
      const audit = buildInventorySourceAudit([item], section === "os" ? [{ externalId: "os", asset: os }] : [], section === "mp" ? [material] : [], [], options);
      const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [item], options);
      assert.equal(classifyOneCAudit(audit.rows).get(item.id)?.category, section === "os" ? "fixedAssets" : "materials");
      addOneCPriceProposals(plan, audit.rows, new Map([["os", os]]), [item]);
      assert.equal(plan.rows[0].eligible, true, JSON.stringify(plan.rows[0]));
      assert.equal(plan.rows[0].nextCode, "00000013205");
      assert.equal(plan.rows[0].price?.nextUnitPrice, "86955.00");
      assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
    });
  }
}

test("the reported cabinet receives MP code and unit price together", () => {
  const audit = buildInventorySourceAudit([card], [], [material], [], options);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [card], options);
  addOneCPriceProposals(plan, audit.rows, new Map(), [card]);
  assert.equal(plan.rows[0].nextCode, "00000013205");
  assert.equal(plan.rows[0].price?.nextUnitPrice, "86955.00");
});

for (const identifier of ["1350*16355", "1350_16355", "1350:16355", "*1350/16355*", "1350—16355"]) {
  test(`MP barcode field and marked name accept the same full identifier: ${identifier}`, () => {
    for (const source of [{ ...material, nomenclature: "Шкаф", barcode: identifier }, { ...material, nomenclature: `Шкаф №${identifier}` }]) {
      const audit = buildInventorySourceAudit([card], [], [source], [], options);
      const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [card], options);
      addOneCPriceProposals(plan, audit.rows, new Map(), [card]);
      assert.equal(plan.rows[0].eligible, true, JSON.stringify(plan.rows[0]));
      assert.equal(plan.rows[0].price?.nextUnitPrice, "86955.00");
    }
  });
}

test("an unmarked complete inventory number in the card name is searchable", () => {
  const item = { ...card, name: "Шкаф 1350/16355", inventoryNumber: "TMP-2026-000001" };
  const audit = buildInventorySourceAudit([item], [], [material], [], options);
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, [item], options).rows[0].eligible, true);
});

test("a complete local barcode can identify a temporary card; fallback IDs cannot", () => {
  for (const value of ["*YUB-1350/16355*", "1350*16355", "YUI-0123456789ABCDEF"]) {
    const item = { ...card, name: "Шкаф", inventoryNumber: "TMP-2026-000001", inventoryNumberKind: "temporary", localBarcodes: [value] };
    const audit = buildInventorySourceAudit([item], [], [material], [], options);
    const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [item], options);
    assert.equal(plan.rows[0].eligible, !value.startsWith("YUI-"));
  }
});

test("equal models, dates, dimensions and partial identifiers cannot acquire a code or price", () => {
  for (const name of ["Шкаф 09.10.2024", "Шкаф 1500*1500*500", "Шкаф HP135016355", "Шкаф №1350/163550", "Шкаф №01350/16355"]) {
    const item = { ...card, name, inventoryNumber: "TMP-2026-000001", inventoryNumberKind: "temporary" };
    const audit = buildInventorySourceAudit([item], [], [material], [], options);
    const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [item], options);
    assert.equal(plan.rows[0].eligible, false);
  }
});

test("a source shared by two site-name identities cannot overwrite either card", () => {
  const items = ["a", "b"].map(id => ({ ...card, id, inventoryNumber: `TMP-${id}`, inventoryNumberKind: "temporary" }));
  const audit = buildInventorySourceAudit(items, [], [material], [], options);
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, items, options).counts.ready, 0);
});
