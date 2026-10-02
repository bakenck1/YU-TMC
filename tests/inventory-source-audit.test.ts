import assert from "node:assert/strict";
import test from "node:test";
import { auditNeedsReview, buildInventorySourceAudit, extractExcelInventoryNumber, type AuditItem, type ExcelSourceRow } from "../lib/inventory-source-audit";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";

test("extracts marked XLS numbers without range expansion or dates", () => {
  assert.equal(extractExcelInventoryNumber("холодильник №1350/16812 от 06.11.2025"), "1350/16812");
  assert.equal(extractExcelInventoryNumber("инв. №206/1832-1837 15.10.11"), "206/1832");
  assert.equal(extractExcelInventoryNumber("ноутбук №1350-00065"), "1350-00065");
  assert.equal(extractExcelInventoryNumber("без номера 1350/16812"), null);
});

test("audits every item once and preserves repeated Excel rows and both sources", () => {
  const item = (id: string, number: string, name = id, kind = "official"): AuditItem => ({ id, name, inventoryNumber: number, inventoryNumberKind: kind, oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 });
  const excel = (rowNumber: number, inventoryNumber: string, nomenclature: string, endingBalance = "0"): ExcelSourceRow => ({ rowNumber, inventoryNumber, nomenclature, endingBalance });
  const asset = { externalId: "one-c-1", asset: { externalId: "one-c-1", code: null, inventoryNumber: "1350/16812", barcode: null, name: "холодильник", status: "Снято с учёта" } as OneCFixedAsset };
  const audit = buildInventorySourceAudit(
    [item("a", "1350/16812", "холодильник"), item("b", "206/1832"), item("c", "206/1833"), item("d", "TMP-2026-000001", "temp", "temporary")],
    [asset],
    [excel(2, "1350/16812", "холодильник №1350/16812", "0"), excel(3, "1350/16812", "другое №1350/16812"), excel(4, "206/1832", "шкаф №206/1832-1837")],
    [],
  );
  assert.deepEqual(audit.counts, { total: 4, oneCOnly: 0, excelOnly: 1, both: 1, missing: 2, temporary: 1, possible: 0 });
  assert.equal(audit.rows[0].source, "1c+excel");
  assert.deepEqual(audit.rows[0].excel.map((row) => row.rowNumber), [2, 3]);
  assert.equal(audit.rows[0].oneC[0].status, "Снято с учёта");
  assert.equal(audit.rows[2].result, "missing");
  assert.equal(audit.rows[3].result, "temporary");
});

test("a current official Code 39 barcode can supply the exact Excel number, but an ID fallback cannot", () => {
  const base: AuditItem = { id: "item", name: "Стол", inventoryNumber: "SITE-1", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: ["*YUB-1350/16812*"], version: 1 };
  const excel: ExcelSourceRow[] = [{ rowNumber: 7, nomenclature: "стол №1350/16812", inventoryNumber: "1350/16812", endingBalance: "0" }];
  assert.equal(buildInventorySourceAudit([base], [], excel, []).rows[0].source, "excel");
  assert.deepEqual(buildInventorySourceAudit([base], [], excel, []).rows[0].excel[0].matchedBarcodes, ["*YUB-1350/16812*"]);
  assert.equal(buildInventorySourceAudit([{ ...base, officialBarcodes: ["YUI-1234567890ABCDEF"] }], [], excel, []).rows[0].source, null);
});

test("active local barcode matches only the exact external value and records evidence", () => {
  const base: AuditItem = { id: "11111111-1111-4111-8111-111111111111", name: "Стол", inventoryNumber: "TMP-2026-000001", inventoryNumberKind: "temporary", oneCCode: null, sourceCodes: [], officialBarcodes: [], localBarcodes: ["1350-00065-0001"], version: 1 };
  const external = (barcode: string) => ({ externalId: barcode, asset: { externalId: barcode, code: null, inventoryNumber: null, barcode, name: "Стол", status: "Не в учёте" } as OneCFixedAsset });
  const rows: ExcelSourceRow[] = [{ rowNumber: 10, nomenclature: "Стол №1350-00065-0001", inventoryNumber: "1350-00065-0001", endingBalance: "0" }];
  const matched = buildInventorySourceAudit([base], [external("*1350-00065-0001*")], rows, []).rows[0];
  assert.equal(matched.source, "1c+excel");
  assert.deepEqual(matched.oneC[0].matchedBy, ["barcode"]);
  assert.deepEqual(matched.oneC[0].matchedBarcodes, ["1350-00065-0001"]);
  assert.deepEqual(matched.excel[0].matchedBarcodes, ["1350-00065-0001"]);
  assert.deepEqual(matched.siteBarcodes, [{ kind: "local", value: "1350-00065-0001" }]);
  assert.equal(buildInventorySourceAudit([base], [external("1350-00065-00010")], [], []).rows[0].source, null);
});

test("YUI item ID barcode finds an exact 1C barcode without inventing an Excel match", () => {
  const id = "12345678-90ab-4cde-8f01-23456789abcd";
  const item: AuditItem = { id, name: "Ноутбук", inventoryNumber: "TMP-2026-000002", inventoryNumberKind: "temporary", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const barcode = "YUI-1234567890AB4CDE";
  const asset = { externalId: "asset-1", asset: { externalId: "asset-1", code: null, inventoryNumber: null, barcode, name: "Ноутбук", status: "Снято с учёта" } as OneCFixedAsset };
  const row = buildInventorySourceAudit([item], [asset], [], []).rows[0];
  assert.equal(row.source, "1c");
  assert.deepEqual(row.oneC[0].matchedBy, ["barcode"]);
  assert.equal(row.oneC[0].barcode, barcode);
});

test("labels a match from the selected batch when the current 1C record changed", () => {
  const item: AuditItem = { id: "item-1", name: "Моноблок", inventoryNumber: "2413/0528", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: ["2413/0528"], version: 1 };
  const batchAsset = { externalId: "asset-1", asset: { externalId: "asset-1", code: null, inventoryNumber: "2413/0528", barcode: null, name: "Моноблок", status: "Принято к учёту" } as OneCFixedAsset, origins: ["selected_batch" as const] };
  const currentAsset = { externalId: "asset-1", asset: { ...batchAsset.asset, inventoryNumber: "DIFFERENT" }, origins: ["current_registry" as const] };
  const row = buildInventorySourceAudit([item], [currentAsset, batchAsset], [], []).rows[0];
  assert.equal(row.source, "1c");
  assert.equal(row.oneC.length, 1);
  assert.deepEqual(row.oneC[0].origins, ["selected_batch"]);
  assert.equal(row.oneC[0].inventoryNumber, "2413/0528");
});

test("preserves the selected batch analysis result when its identifiers no longer agree", () => {
  const item: AuditItem = { id: "item-1", name: "Моноблок", inventoryNumber: "2413/0528", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const asset = { externalId: "asset-1", asset: { externalId: "asset-1", code: "OLD", inventoryNumber: "2413/0999", barcode: null, name: "Моноблок", status: "Снято с учёта" } as OneCFixedAsset, origins: ["selected_batch" as const], batchMatchedItemId: "item-1" };
  const row = buildInventorySourceAudit([item], [asset], [], []).rows[0];
  assert.equal(row.source, "1c");
  assert.deepEqual(row.oneC[0].matchedBy, ["batch_analysis"]);
  assert.deepEqual(row.oneC[0].origins, ["selected_batch"]);
});

test("finds a missing slash in either direction without treating the number as exact", () => {
  const item = (id: string, number: string): AuditItem => ({ id, name: "Лабораторный стенд", inventoryNumber: number, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [number], version: 1 });
  const asset = (id: string, inventoryNumber: string) => ({ externalId: id, asset: { externalId: id, code: null, inventoryNumber, barcode: null, name: "Лабораторный стенд", status: "Принято к учёту" } as OneCFixedAsset });
  const rows = buildInventorySourceAudit(
    [item("a", "123/759"), item("b", "456789")],
    [asset("one-c-a", "123759"), asset("one-c-b", "456/789")],
    [{ rowNumber: 2, nomenclature: "Стенд №123759", inventoryNumber: "123759", endingBalance: "0" }],
    [],
  );
  assert.deepEqual(rows.counts, { total: 2, oneCOnly: 1, excelOnly: 0, both: 1, missing: 0, temporary: 0, possible: 2 });
  assert.deepEqual(rows.rows[0].oneC[0].matchedBy, ["number_without_slash"]);
  assert.deepEqual(rows.rows[0].excel[0].matchedBy, ["number_without_slash"]);
  assert.equal(auditNeedsReview(rows.rows[0]), true);
  assert.equal(auditNeedsReview(rows.rows[1]), true);
});

test("slashless search preserves leading zeroes and hyphens and shows ambiguous candidates", () => {
  const item = (id: string, number: string): AuditItem => ({ id, name: "Стенд", inventoryNumber: number, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 });
  const source = { externalId: "source", asset: { externalId: "source", code: null, inventoryNumber: "123759", barcode: null, name: "Стенд", status: "Не в учёте" } as OneCFixedAsset };
  const audit = buildInventorySourceAudit([item("a", "123/759"), item("b", "12/3759"), item("c", "123/0759"), item("d", "123-759"), item("e", "1/23/759")], [source], [], []);
  assert.deepEqual(audit.rows.filter((row) => row.source === "1c").map((row) => row.itemId), ["a", "b"]);
  assert.equal(audit.counts.possible, 2);
});

test("an exact source row stays primary when another 1C row only matches without a slash", () => {
  const item: AuditItem = { id: "item", name: "Стенд", inventoryNumber: "123/759", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const asset = (externalId: string, inventoryNumber: string) => ({ externalId, asset: { externalId, code: null, inventoryNumber, barcode: null, name: "Стенд", status: "Принято к учёту" } as OneCFixedAsset });
  const row = buildInventorySourceAudit([item], [asset("a-weak", "123759"), asset("z-exact", "123/759")], [], []).rows[0];
  assert.deepEqual(row.oneC.map((entry) => entry.externalId), ["z-exact", "a-weak"]);
  assert.equal(auditNeedsReview(row), false);
});

test("a blocked batch row with a recorded item stays visible as source evidence", () => {
  const item: AuditItem = { id: "item-1", name: "Стенд", inventoryNumber: "123/759", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const oneC = { externalId: "source", asset: { externalId: "source", code: null, inventoryNumber: "OTHER", barcode: null, name: "Стенд", status: "Не в учёте" } as OneCFixedAsset, origins: ["selected_batch" as const], batchMatchedItemId: "item-1", reviewState: "conflict" };
  const row = buildInventorySourceAudit([item], [oneC], [], []).rows[0];
  assert.equal(row.source, "1c");
  assert.equal(row.oneC[0].reviewState, "conflict");
  assert.deepEqual(row.oneC[0].matchedBy, ["batch_analysis"]);
});
