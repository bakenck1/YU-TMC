import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryAuditEnrichmentPlan, type InventoryAuditEnrichmentItem } from "../lib/inventory-audit-enrichment";
import type { AuditMatch } from "../lib/inventory-source-audit";

function fixture(): { item: InventoryAuditEnrichmentItem; row: AuditMatch } {
  return {
    item: { id: "site-1", name: "Ноутбук", inventoryNumber: "2411/00388", officialBarcodes: ["2411/00388"], oneCCode: null, version: 7, itemSection: "general", archivedAt: null },
    row: {
      itemId: "site-1", itemName: "Ноутбук", siteNumber: "2411/00388", siteBarcodes: [{ value: "2411/00388", kind: "official" }], numberKind: "official", itemVersion: 7, result: "matched", source: "1c+excel",
      oneC: [{ externalId: "asset-1", code: "00003254", inventoryNumber: "241100388", barcode: null, name: "Ноутбук Lenovo IdeaPad №2411/00388", status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["number_without_slash"], matchedBarcodes: ["2411/00388"] }],
      excel: [{ rowNumber: 14, inventoryNumber: "2411/00388", nomenclature: "Ноутбук Lenovo №2411/00388", oneCCode: "00003254", endingBalance: "1", inventoryReferences: [{ inventoryNumber: "2411/00388" }], matchedBy: ["site_number"] }],
    },
  };
}

test("confirmed screenshot identifiers use the 1C name and preserve every code zero", () => {
  const { item, row } = fixture();
  const before = JSON.stringify({ item, row });
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 1, unchanged: 0, skipped: 0 });
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].nextName, "Ноутбук Lenovo IdeaPad №2411/00388");
  assert.equal(plan.rows[0].nextCode, "00003254");
  assert.equal(plan.rows[0].externalId, "asset-1");
  assert.equal(plan.rows[0].excelRowNumber, 14);
  assert.equal(JSON.stringify({ item, row }), before, "Planning must never mutate saved evidence or live items");
});

test("internal digit spaces and separator spaces retain the same complete identifier", () => {
  for (const value of ["2411 / 00388", "24 11/00 388", "2411\u00a000388", "２４１１/００３８８"]) {
    const { item, row } = fixture();
    row.oneC[0].inventoryNumber = value;
    assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).rows[0].eligible, true, value);
  }
});

test("an existing equal code can receive a confirmed authoritative name and then be unchanged", () => {
  const { item, row } = fixture();
  item.oneCCode = "00003254";
  assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).counts.ready, 1);
  item.name = row.oneC[0].name;
  row.itemName = item.name;
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.deepEqual(plan.counts, { ready: 0, unchanged: 1, skipped: 0 });
  assert.equal(plan.rows[0].changed, false);
});

test("a temporary site number can use a verified official barcode, never a local group barcode", () => {
  const { item, row } = fixture();
  item.inventoryNumber = row.siteNumber = "TMP-2026-001";
  row.numberKind = "temporary";
  assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).rows[0].eligible, true);
  item.officialBarcodes = [];
  row.siteBarcodes = [{ value: "2411/00388", kind: "local" }];
  assert.equal(buildInventoryAuditEnrichmentPlan([row], [item]).rows[0].eligible, false);
});

type Mutation = (value: ReturnType<typeof fixture>) => void;
const rejected: [string, Mutation][] = [
  ["archived item", ({ item }) => { item.archivedAt = "2026-10-05T00:00:00Z"; }],
  ["IT card", ({ item }) => { item.itemSection = "it"; }],
  ["changed item version", ({ item }) => { item.version++; }],
  ["changed site number even without a version bump", ({ item }) => { item.inventoryNumber = "2411/00389"; }],
  ["historical-only 1C entry", ({ row }) => { row.oneC[0].origins = ["selected_batch"]; }],
  ["missing Excel", ({ row }) => { row.excel = []; }],
  ["missing 1C", ({ row }) => { row.oneC = []; }],
  ["missing Excel code", ({ row }) => { row.excel[0].oneCCode = null; }],
  ["missing 1C code", ({ row }) => { row.oneC[0].code = null; }],
  ["code mismatch", ({ row }) => { row.excel[0].oneCCode = "00003255"; }],
  ["lost code zeroes", ({ row }) => { row.excel[0].oneCCode = "3254"; }],
  ["existing conflicting site code", ({ item }) => { item.oneCCode = "00009999"; }],
  ["structured number conflict despite matchedBy flag", ({ row }) => { row.oneC[0].inventoryNumber = "241100389"; row.oneC[0].matchedBy = ["guid", "code", "inventory_number"]; }],
  ["leading-zero identifier difference", ({ row }) => { row.oneC[0].inventoryNumber = "24110388"; }],
  ["different slash boundary", ({ row }) => { row.oneC[0].inventoryNumber = "24110/0388"; }],
  ["hyphen removed", ({ row }) => { row.oneC[0].inventoryNumber = "2411-00388"; }],
  ["suffix-only candidate", ({ row }) => { row.oneC[0].inventoryNumber = "2411/00388-97"; row.oneC[0].matchedBy = ["number_suffix"]; }],
  ["contradictory 1C barcode", ({ row }) => { row.oneC[0].barcode = "2411/00389"; }],
  ["contradictory description number", ({ row }) => { row.oneC[0].name = "Ноутбук №2411/00389"; }],
  ["contradictory Excel complete reference", ({ row }) => { row.excel[0].sourceInventoryNumber = "2411/00388-00389"; }],
  ["contradictory Excel description", ({ row }) => { row.excel[0].nomenclature = "Ноутбук №2411/00389"; }],
  ["code and name alone", ({ item, row }) => { item.inventoryNumber = row.siteNumber = "TMP-1"; item.officialBarcodes = []; row.oneC[0].inventoryNumber = null; row.oneC[0].barcode = null; }],
  ["empty 1C name", ({ row }) => { row.oneC[0].name = "   "; }],
  ["overlong 1C name", ({ row }) => { row.oneC[0].name = "А".repeat(161); }],
  ["overlong agreed codes", ({ row }) => { row.oneC[0].code = row.excel[0].oneCCode = "0".repeat(65); }],
  ["multiple Excel candidates with different codes", ({ row }) => { row.excel.push({ ...row.excel[0], rowNumber: 15, oneCCode: "00003255" }); }],
  ["multiple Excel rows even with the same code", ({ row }) => { row.excel.push({ ...row.excel[0], rowNumber: 15 }); }],
  ["multiple 1C external identities", ({ row }) => { row.oneC.push({ ...row.oneC[0], externalId: "asset-2" }); }],
  ["conflicting duplicate 1C evidence", ({ row }) => { row.oneC.push({ ...row.oneC[0], code: "00003255" }); }],
];
for (const [label, mutate] of rejected) {
  test(`enrichment skips ${label} instead of selecting or inventing a value`, () => {
    const value = fixture();
    mutate(value);
    const plan = buildInventoryAuditEnrichmentPlan([value.row], [value.item]);
    assert.deepEqual(plan.counts, { ready: 0, unchanged: 0, skipped: 1 });
    assert.equal(plan.rows[0].eligible, false, label);
    assert.equal(plan.rows[0].changed, false, label);
    assert.ok(plan.rows[0].reason);
    assert.equal(plan.rows[0].nextName, value.item.name);
    assert.equal(plan.rows[0].nextCode, value.item.oneCCode);
  });
}

test("one physical Excel row shared by two cards cannot update either card", () => {
  const first = fixture(), second = fixture();
  second.item.id = second.row.itemId = "site-2";
  second.row.oneC[0].externalId = "asset-2";
  const plan = buildInventoryAuditEnrichmentPlan([first.row, second.row], [first.item, second.item]);
  assert.equal(plan.counts.skipped, 2);
  assert.ok(plan.rows.every((row) => row.reason === "source_reused"));
});

test("one current 1C identity shared by two cards cannot update either card", () => {
  const first = fixture(), second = fixture();
  second.item.id = second.row.itemId = "site-2";
  second.row.excel[0].rowNumber = 15;
  const plan = buildInventoryAuditEnrichmentPlan([first.row, second.row], [first.item, second.item]);
  assert.equal(plan.counts.skipped, 2);
  assert.ok(plan.rows.every((row) => row.reason === "source_reused"));
});

test("a deleted item remains visible as skipped and never gains an update", () => {
  const { row } = fixture();
  const plan = buildInventoryAuditEnrichmentPlan([row], []);
  assert.equal(plan.rows[0].reason, "item_not_found");
  assert.equal(plan.counts.skipped, 1);
});

test("a code normalized with trim and NFKC agrees while retaining leading zeroes", () => {
  const { item, row } = fixture();
  row.oneC[0].code = " ００００３２５４ ";
  row.excel[0].oneCCode = "00003254";
  const plan = buildInventoryAuditEnrichmentPlan([row], [item]);
  assert.equal(plan.rows[0].eligible, true);
  assert.equal(plan.rows[0].nextCode, "00003254");
});
