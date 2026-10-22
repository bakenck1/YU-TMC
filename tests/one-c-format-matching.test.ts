import assert from "node:assert/strict";
import test from "node:test";
import { inventoryAuditNumbersEqual, inventoryAuditRange, inventoryAuditRangeContains, extractFormattedInventoryReferences } from "../lib/inventory-audit-numbers";
import { buildInventorySourceAudit, type AuditItem, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { classifyOneCAudit, summarizeOneCAudit } from "../lib/one-c-analytics";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";

const card: AuditItem = { id: "card", name: "Стол", inventoryNumber: "1350/14444", inventoryNumberKind: "official", oneCCode: null, officialBarcodes: [], sourceCodes: [], version: 1 };
const asset = (name: string, inventoryNumber: string | null = null): OneCFixedAsset => ({ externalId: "asset", name, inventoryNumber, barcode: null, code: "CODE", category: null, location: null, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null, quantity: 1, residualCost: null, acceptedAt: null, updatedAt: null });
const options = { descriptionBarcodes: true, formattedNumbers: true };

for (const number of ["135014444", "1350-14444", "1350.14444", "13 50 / 14 444", "1350\u00a014444"]) {
  test(`whole identifier ignores presentation separators in the name: ${number}`, () => {
    const source = asset(`Стол №${number}`);
    const audit = buildInventorySourceAudit([card], [{ externalId: "asset", asset: source }], [], [], options);
    assert.equal(classifyOneCAudit(audit.rows).get(card.id)?.category, "fixedAssets");
    const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...card, itemSection: "general", status: "active" }], { allowDescriptionIdentity: true, formattedNumbers: true });
    assert.equal(plan.rows[0].eligible, true);
    assert.equal(plan.rows[0].nextName, source.name);
  });
}

test("formatted fields agree, but changed digits, zeros and complete suffixes stay different", () => {
  for (const different of ["01350/14444", "1350/144440", "1350/14444-19", "1350/14443"]) assert.equal(inventoryAuditNumbersEqual(card.inventoryNumber, different), false);
  const audit = buildInventorySourceAudit([card], [{ externalId: "asset", asset: asset("Стол №1350.14444", "1350 14444") }], [], [], options);
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...card, itemSection: "general" }], { allowDescriptionIdentity: true, formattedNumbers: true }).counts.ready, 1);
});

test("all marked formatted identifiers must agree before OS or MP updates", () => {
  for (const [name, inventoryNumber] of [
    ["Стол №1350.14445", card.inventoryNumber],
    ["Стол №1350.14444; №1350.14445", null],
    ["Стол №1350.14444; №13 50 / 14 445", null],
    ["Стол №1350.14444; инв. 1350.14445", null],
  ] as const) {
    const source = asset(name, inventoryNumber);
    const material: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "mp", rowNumber: 1, oneCCode: "MP", nomenclature: name, inventoryNumber: inventoryNumber ?? "", explicitInventoryNumber: inventoryNumber, endingBalance: "1" };
    for (const audit of [
      buildInventorySourceAudit([card], [{ externalId: "asset", asset: source }], [], [], options),
      buildInventorySourceAudit([card], [], [material], [], options),
    ]) {
      const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...card, itemSection: "general", status: "active" }], { allowDescriptionIdentity: true, formattedNumbers: true });
      assert.equal(plan.rows[0].eligible, false);
      assert.equal(plan.rows[0].reason, "identity_conflict");
    }
  }
});

test("quantity, floor and date annotations are not appended to complete dotted numbers", () => {
  for (const suffix of ["1 шт", "1шт", "2 этаж", "22.10.2026", "2026-10-22"]) {
    const source = asset(`Стол №1350.14444 ${suffix}`);
    assert.deepEqual(extractFormattedInventoryReferences(source.name), [{ inventoryNumber: "1350.14444", numberIsUnmarked: false }]);
    const other = { ...card, id: "other", inventoryNumber: "1350/144441" };
    const audit = buildInventorySourceAudit([card, other], [{ externalId: "asset", asset: source }], [], [], options);
    assert.equal(classifyOneCAudit(audit.rows).get(card.id)?.category, "fixedAssets");
    assert.equal(classifyOneCAudit(audit.rows).get(other.id)?.category, "missing");
    const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [card, other].map(item => ({ ...item, itemSection: "general" })), { allowDescriptionIdentity: true, formattedNumbers: true });
    assert.equal(plan.rows[0].eligible, true);
    assert.equal(plan.rows[1].eligible, false);
  }
});

test("range members are found in MP without inventing or expanding range prefixes", () => {
  const cards = ["206/1832", "206/1835", "206/1837", "206/1838", "0206/1835"].map((number, index) => ({ ...card, id: `c${index}`, inventoryNumber: number }));
  const material: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "mp", rowNumber: 1, oneCCode: "MP", nomenclature: "Холодильник №206/1832-1837", inventoryNumber: "", endingBalance: "4" };
  const audit = buildInventorySourceAudit(cards, [], [material], [], options);
  const presence = classifyOneCAudit(audit.rows);
  for (const index of [0, 1, 2]) assert.equal(presence.get(`c${index}`)?.category, "materials");
  for (const index of [3, 4]) assert.equal(presence.get(`c${index}`)?.category, "missing");
  // Presence of a grouped record does not authorize applying its owner or price to every card.
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, cards.map(item => ({ ...item, itemSection: "general" })), { allowDescriptionIdentity: true, formattedNumbers: true });
  assert.equal(plan.counts.ready, 0);
});

test("short range ends require matching source quantity and keep zero padding", () => {
  assert.equal(inventoryAuditRange("050-0002060-63", 1), null);
  const range = inventoryAuditRange("050-0002060-63", 4)!;
  assert.ok(range);
  for (const number of ["050/0002060", "050 0002062", "050.0002063"]) assert.equal(inventoryAuditRangeContains(number, range), true);
  for (const number of ["050-0002064", "050-2060", "0050-0002060"]) assert.equal(inventoryAuditRangeContains(number, range), false);
  assert.equal(inventoryAuditRange("020-0008403-19", 1), null);
  assert.equal(inventoryAuditRange("206/1000-99999999", 1), null);
});

test("MP balances may split the quantity supporting a short range across owners", () => {
  const materials: ExcelSourceRow[] = [1, 2].map(index => ({ sourceKind: "materials_api", sourceKey: `m${index}`, rowNumber: index, oneCCode: "MP", nomenclature: "Стол №050-0002060-63", inventoryNumber: "", endingBalance: "2" }));
  const audit = buildInventorySourceAudit([{ ...card, inventoryNumber: "050-0002062" }], [], materials, [], options);
  assert.equal(classifyOneCAudit(audit.rows).get(card.id)?.category, "materials");
});

test("dates, model fragments and dimension fragments are not independent inventory tokens", () => {
  for (const name of ["Цена 123.45 KZT", "Стол 2026.10.22", "Стол 10.12.25", "Стол 22-10-2026", "Стол 1500*1500*500", "Принтер HP14444"]) {
    assert.deepEqual(extractFormattedInventoryReferences(name), []);
  }
  assert.equal(extractFormattedInventoryReferences("Принтер 1350/14444 99A").some(ref => ref.inventoryNumber === card.inventoryNumber), false);
});

test("an unmarked calendar date cannot confirm a card or authorize updates", () => {
  const item = { ...card, inventoryNumber: "22102026" };
  const audit = buildInventorySourceAudit([item], [{ externalId: "asset", asset: asset("Стол 22-10-2026") }], [], [], options);
  assert.equal(classifyOneCAudit(audit.rows).get(item.id)?.category, "missing");
  assert.equal(buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...item, itemSection: "general" }], { allowDescriptionIdentity: true, formattedNumbers: true }).counts.ready, 0);
});

test("temporary unmatched cards have a separate total and do not inflate missing", () => {
  const audit = buildInventorySourceAudit([{ ...card, id: "temp", inventoryNumber: "TMP-2026-1", inventoryNumberKind: "temporary" }, card], [], [], [], options);
  const counts = summarizeOneCAudit(audit.rows, [], []);
  assert.equal(counts.temporary, 1);
  assert.equal(counts.temporaryUnmatched, 1);
  assert.equal(counts.missing, 1);
  assert.equal(counts.fixedAssets + counts.materials + counts.both + counts.possible + counts.missing + counts.temporaryUnmatched, counts.total);
});
