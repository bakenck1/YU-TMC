import assert from "node:assert/strict";
import test from "node:test";
import { auditNeedsReview, buildInventorySourceAudit, extractExcelInventoryNumber, extractExcelInventoryReference, extractExcelInventoryReferences, type AuditItem, type ExcelSourceRow } from "../lib/inventory-source-audit";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { matchOneCFixedAssetIdentifiers } from "../lib/one-c-reconciliation";

test("extracts marked XLS numbers without range expansion or dates", () => {
  assert.equal(extractExcelInventoryNumber("холодильник №1350/16812 от 06.11.2025"), "1350/16812");
  assert.equal(extractExcelInventoryNumber("инв. №206/1832-1837 15.10.11"), "206/1832");
  assert.equal(extractExcelInventoryNumber("ноутбук №1350-00065"), "1350-00065");
  assert.equal(extractExcelInventoryNumber("без номера 1350/16812"), "1350/16812");
});

test("recognizes description numbers and marker variants while preserving exact digits and separators", () => {
  assert.deepEqual(extractExcelInventoryReference("Планшет Samsung Galaxy Tab 1350/14464 от 26.03.20"), { inventoryNumber: "1350/14464", numberIsUnmarked: true });
  assert.deepEqual(extractExcelInventoryReference("Плита Gefest 1140 ком. инв.№206/486-487 15 этаж"), { inventoryNumber: "206/486", sourceInventoryNumber: "206/486-487" });
  for (const marker of ["№", "инв.", "инв. №", "N", "No.", "Инвентарный номер"]) {
    assert.equal(extractExcelInventoryNumber(`Принтер ${marker}050-0002223 от 15.02.13`), "050-0002223");
  }
  assert.equal(extractExcelInventoryNumber("№1350/ 00065 15 этаж"), "1350/ 00065");
  assert.equal(extractExcelInventoryNumber("№1350/00065 от 15.02.13"), "1350/00065");
  assert.equal(extractExcelInventoryNumber("№123 456"), "123 456");
  assert.equal(extractExcelInventoryNumber("№1350/14 464"), "1350/14 464");
  assert.equal(extractExcelInventoryNumber("№1350/14464.5"), null);
  assert.equal(extractExcelInventoryNumber("№1350-00065.4"), null);
  assert.deepEqual(extractExcelInventoryReference("без номера 14464"), { inventoryNumber: "14464", numberIsUnmarked: true });
  for (const description of ["скотч 48/300", "профиль ПП 60/27", "CF-200/500", "гитара 25/09/14", "картридж 435/436/285", "картридж 123 / 456 / 789", "123/456 -789x", "Galaxy1350/14464", "1350/14464GB"]) {
    assert.equal(extractExcelInventoryReference(description), null, description);
  }
});

test("finds literal ranges and first members, keeps unmarked evidence tentative and never finds a substring", () => {
  const item = (id: string, inventoryNumber: string): AuditItem => ({ id, name: "Предмет", inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 });
  const excel = (rowNumber: number, nomenclature: string): ExcelSourceRow => ({ rowNumber, nomenclature, ...extractExcelInventoryReference(nomenclature)!, endingBalance: "0" });
  const audit = buildInventorySourceAudit([item("a", "1350/14464"), item("b", "206/486-487"), item("c", "206/486"), item("d", "206/487"), item("e", "1350/1446")], [], [excel(3831, "Планшет Samsung Galaxy Tab 1350/14464 от 26.03.20"), excel(3832, "Плита инв.№206/486-487 15 этаж")], []);
  assert.deepEqual(audit.rows.map((row) => row.source), ["excel", "excel", "excel", null, null]);
  assert.equal(auditNeedsReview(audit.rows[0]), true);
  assert.equal(auditNeedsReview(audit.rows[1]), false);
  assert.equal(audit.counts.possible, 1);
});

test("an exact Excel match retains its evidence when another barcode matches the same row without slash", () => {
  const item: AuditItem = { id: "item", name: "Стенд", inventoryNumber: "123/759", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: ["123759"], version: 1 };
  const audit = buildInventorySourceAudit([item], [], [{ rowNumber: 2, inventoryNumber: "123/759", nomenclature: "Стенд №123/759", endingBalance: "0" }], []);
  assert.equal(audit.rows[0].excel.length, 1);
  assert.equal(auditNeedsReview(audit.rows[0]), false);
  assert.ok(audit.rows[0].excel[0].matchedBy?.includes("site_number"));
  assert.deepEqual(audit.rows[0].excel[0].matchedBarcodes, ["123759"]);
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
  assert.deepEqual(audit.rows.filter((row) => row.source === "1c").map((row) => row.itemId), ["a", "b", "e"]);
  assert.equal(audit.counts.possible, 3);
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

test("plain numbers without an inventory marker are searchable in either slash format", () => {
  const item = (id: string, inventoryNumber: string): AuditItem => ({ id, name: "Лабораторный стенд", inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 });
  const nomenclature = "Лабораторный стенд 123768 от 24.05.24";
  const reference = extractExcelInventoryReference(nomenclature);
  assert.deepEqual(reference, { inventoryNumber: "123768", numberIsUnmarked: true });
  const excel: ExcelSourceRow[] = [{ rowNumber: 65_000, nomenclature, ...reference!, endingBalance: "0" }];
  const audit = buildInventorySourceAudit([item("slash", "123/768"), item("plain", "123768")], [], excel, []);
  assert.deepEqual(audit.rows.map((row) => row.source), ["excel", "excel"]);
  assert.ok(audit.rows.every((row) => auditNeedsReview(row)));
  assert.equal(audit.counts.missing, 0);
  assert.equal(audit.counts.possible, 2);
});

test("searches every marked and unmarked number in one description and displays the matched reference", () => {
  const nomenclature = "Комплект №123/768; №1350-00065; планшет 1350/14464; стенд 987654 от 26.03.20";
  const references = extractExcelInventoryReferences(nomenclature);
  assert.deepEqual(references.map((reference) => reference.inventoryNumber).sort(), ["123/768", "1350-00065", "1350/14464", "987654"].sort());
  assert.equal(references.find((reference) => reference.inventoryNumber === "123/768")?.numberIsUnmarked, undefined);
  assert.equal(references.find((reference) => reference.inventoryNumber === "1350/14464")?.numberIsUnmarked, true);
  const excel: ExcelSourceRow[] = [{ rowNumber: 8, nomenclature, ...references[0], inventoryReferences: references, endingBalance: "2" }];
  const items = references.map((reference, index): AuditItem => ({ id: String(index), name: "Комплект", inventoryNumber: reference.inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 }));
  const audit = buildInventorySourceAudit(items, [], excel, []);
  assert.equal(audit.counts.excelOnly, 4);
  for (const row of audit.rows) {
    assert.equal(row.excel.length, 1);
    assert.equal(row.excel[0].rowNumber, 8);
    assert.equal(row.excel[0].inventoryNumber, references[0].inventoryNumber);
    assert.equal(row.excel[0].matchedInventoryNumber, row.siteNumber);
    const matchedReference = references.find((reference) => reference.inventoryNumber === row.siteNumber)!;
    assert.equal(row.excel[0].matchedReference?.inventoryNumber, matchedReference.inventoryNumber);
    assert.equal(row.excel[0].matchedReference?.numberIsUnmarked, matchedReference.numberIsUnmarked);
    assert.equal(row.excel[0].matchedReference?.sourceInventoryNumber, matchedReference.sourceInventoryNumber);
    assert.equal(row.excel[0].nomenclature, nomenclature);
  }
});

test("marker prefixes in site and dedicated 1C numbers affect audit search without changing the original values", () => {
  const item = (id: string, inventoryNumber: string): AuditItem => ({ id, name: "Лабораторный стенд", inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 });
  const asset = (externalId: string, inventoryNumber: string) => ({ externalId, asset: { externalId, code: null, inventoryNumber, barcode: null, name: "Лабораторный стенд", status: "Не в учёте" } as OneCFixedAsset });
  const audit = buildInventorySourceAudit(
    [item("a", "№123/768"), item("b", "456/789"), item("c", "инв. №050-00065")],
    [asset("one-c-a", "123768"), asset("one-c-b", "No.456/789"), asset("one-c-c", "050-00065")],
    [
      { rowNumber: 2, inventoryNumber: "123768", nomenclature: "Стенд №123768", endingBalance: "0" },
      { rowNumber: 3, inventoryNumber: "456789", nomenclature: "Стенд №456789", endingBalance: "0" },
      { rowNumber: 4, inventoryNumber: "050-00065", nomenclature: "Стенд №050-00065", endingBalance: "0" },
    ],
    [],
  );
  assert.deepEqual(audit.rows.map((row) => row.source), ["1c+excel", "1c+excel", "1c+excel"]);
  assert.deepEqual(audit.rows.map((row) => row.siteNumber), ["№123/768", "456/789", "инв. №050-00065"]);
  assert.equal(audit.rows[1].oneC[0].inventoryNumber, "No.456/789");
});

test("inventory markers on registered site and 1C barcodes are searchable and retain the original barcode evidence", () => {
  const item: AuditItem = { id: "barcode-item", name: "Стенд", inventoryNumber: "SITE-UNRELATED", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: ["№123/768"], version: 1 };
  const asset = { externalId: "barcode-source", asset: { externalId: "barcode-source", code: null, inventoryNumber: null, barcode: "№123768", name: "Стенд", status: "Снято с учёта" } as OneCFixedAsset };
  const audit = buildInventorySourceAudit([item], [asset], [{ rowNumber: 2, inventoryNumber: "123768", nomenclature: "Стенд №123768", endingBalance: "0" }], []);
  const row = audit.rows[0];
  assert.equal(row.source, "1c+excel");
  assert.equal(row.oneC[0].barcode, "№123768");
  assert.deepEqual(row.siteBarcodes, [{ kind: "official", value: "№123/768" }]);
  assert.deepEqual(row.oneC[0].matchedBarcodes, ["№123/768"]);
  assert.deepEqual(row.excel[0].matchedBarcodes, ["№123/768"]);
});

test("embedded 1C references are searchable when the dedicated number is absent", () => {
  const item: AuditItem = { id: "tablet", name: "Планшет", inventoryNumber: "1350/14464", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const asset = { externalId: "tablet-source", asset: { externalId: "tablet-source", code: null, inventoryNumber: null, barcode: null, name: "Планшет Samsung Galaxy Tab 135014464 от 26.03.20", status: "Не в учёте" } as OneCFixedAsset };
  const row = buildInventorySourceAudit([item], [asset], [], []).rows[0];
  assert.equal(row.source, "1c");
  assert.ok(row.oneC[0].matchedBy.includes("number_in_description"));
  assert.equal(auditNeedsReview(row), true);
});

test("a 1C inventory number can find a different registered site barcode and records that barcode as evidence", () => {
  const item: AuditItem = { id: "barcode-item", name: "Лабораторный стенд", inventoryNumber: "SITE-UNRELATED", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: ["№123/768"], version: 1 };
  const asset = { externalId: "stand-source", asset: { externalId: "stand-source", code: null, inventoryNumber: "123768", barcode: null, name: "Лабораторный стенд", status: "Не в учёте" } as OneCFixedAsset };
  const row = buildInventorySourceAudit([item], [asset], [], []).rows[0];
  assert.equal(row.source, "1c");
  assert.deepEqual(row.oneC[0].matchedBarcodes, ["№123/768"]);
  assert.ok(row.oneC[0].matchedBy.includes("number_without_slash"));
  assert.equal(auditNeedsReview(row), true);
});

test("optional slashes include shifted and multiple separators and the literal source range", () => {
  const item = (id: string, inventoryNumber: string): AuditItem => ({ id, name: "Плита", inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 });
  const asset = { externalId: "stand-source", asset: { externalId: "stand-source", code: null, inventoryNumber: "123/759", barcode: null, name: "Стенд", status: "Не в учёте" } as OneCFixedAsset };
  const reference = extractExcelInventoryReference("Плита №206/486-487");
  const excel: ExcelSourceRow[] = [{ rowNumber: 2, nomenclature: "Плита №206/486-487", ...reference!, endingBalance: "0" }];
  const audit = buildInventorySourceAudit([item("a", "12/3759"), item("b", "1/23/759"), item("c", "206486-487"), item("d", "206/487")], [asset], excel, []);
  assert.deepEqual(audit.rows.map((row) => row.source), ["1c", "1c", "excel", null]);
  assert.ok(audit.rows.slice(0, 3).every((row) => auditNeedsReview(row)));
  assert.equal(audit.rows[2].excel[0].sourceInventoryNumber, "206/486-487");
});

test("duplicates choose the closest name in Excel and 1C while retaining every candidate", () => {
  const item: AuditItem = { id: "stand", name: "Лабораторный стенд", inventoryNumber: "123/768", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const asset = (externalId: string, inventoryNumber: string, name: string) => ({ externalId, asset: { externalId, code: null, inventoryNumber, barcode: null, name, status: "Не в учёте" } as OneCFixedAsset });
  const excel: ExcelSourceRow[] = [
    { rowNumber: 2, inventoryNumber: "123/768", nomenclature: "Холодильник №123/768", endingBalance: "0" },
    { rowNumber: 500, inventoryNumber: "123768", nomenclature: "Лабораторный стенд №123768", endingBalance: "0" },
  ];
  const row = buildInventorySourceAudit([item], [asset("a-exact", "123/768", "Холодильник"), asset("z-similar", "123768", "Лабораторный стенд")], excel, []).rows[0];
  assert.deepEqual(row.excel.map((entry) => entry.rowNumber), [500, 2]);
  assert.deepEqual(row.oneC.map((entry) => entry.externalId), ["z-similar", "a-exact"]);
  assert.equal(row.source, "1c+excel");
  assert.equal(auditNeedsReview(row), false);
});

test("equal names select the same source rows independently of input order", () => {
  const item: AuditItem = { id: "stand", name: "Лабораторный стенд", inventoryNumber: "123/768", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const asset = (externalId: string) => ({ externalId, asset: { externalId, code: null, inventoryNumber: "123/768", barcode: null, name: "Лабораторный стенд", status: "Не в учёте" } as OneCFixedAsset });
  const excel = (rowNumber: number): ExcelSourceRow => ({ rowNumber, inventoryNumber: "123/768", nomenclature: "Лабораторный стенд №123/768", endingBalance: "0" });
  const a = buildInventorySourceAudit([item], [asset("z-last"), asset("a-first")], [excel(500), excel(2)], []).rows[0];
  const b = buildInventorySourceAudit([item], [asset("a-first"), asset("z-last")], [excel(2), excel(500)], []).rows[0];
  assert.deepEqual(a, b);
  assert.deepEqual(a.excel.map((entry) => entry.rowNumber), [2, 500]);
  assert.deepEqual(a.oneC.map((entry) => entry.externalId), ["a-first", "z-last"]);
});

test("close name forms rank above unrelated names when duplicate identifiers have equal confidence", () => {
  const item: AuditItem = { id: "computer", name: "Моноблок", inventoryNumber: "2413/0528", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const asset = (externalId: string, name: string) => ({ externalId, asset: { externalId, code: null, inventoryNumber: "2413/0528", barcode: null, name, status: "Не в учёте" } as OneCFixedAsset });
  const excel: ExcelSourceRow[] = [
    { rowNumber: 2, inventoryNumber: "2413/0528", nomenclature: "Стол №2413/0528", endingBalance: "0" },
    { rowNumber: 500, inventoryNumber: "2413/0528", nomenclature: "Моноблоки №2413/0528", endingBalance: "0" },
  ];
  const row = buildInventorySourceAudit([item], [asset("a-unrelated", "Стол"), asset("z-similar", "Моноблоки")], excel, []).rows[0];
  assert.deepEqual(row.excel.map((entry) => entry.rowNumber), [500, 2]);
  assert.deepEqual(row.oneC.map((entry) => entry.externalId), ["z-similar", "a-unrelated"]);
  assert.equal(row.source, "1c+excel");
  assert.equal(auditNeedsReview(row), false);
});

test("broad number search rejects different digits, hyphens, internal spaces, numeric substrings and name alone", () => {
  const item = (id: string, inventoryNumber: string): AuditItem => ({ id, name: "Лабораторный стенд", inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 });
  const source = { externalId: "stand-source", asset: { externalId: "stand-source", code: "123/768", inventoryNumber: "123768", barcode: null, name: "Лабораторный стенд", status: "Не в учёте" } as OneCFixedAsset };
  const reference = extractExcelInventoryReference("Лабораторный стенд 123768 от 24.05.24");
  const excel: ExcelSourceRow[] = [{ rowNumber: 2, nomenclature: "Лабораторный стенд 123768 от 24.05.24", ...reference!, endingBalance: "0" }];
  const audit = buildInventorySourceAudit([item("a", "123/0768"), item("b", "123-768"), item("c", "123 768"), item("d", "1237680"), item("e", "12376"), item("f", "OTHER")], [source], excel, []);
  assert.equal(audit.counts.missing, 6);
  assert.ok(audit.rows.every((row) => row.source === null));
  for (const description of ["Модель X123768", "Модель 123768GB", "от 24.05.2024", "от 2026-10-02", "от 26-03-2020", "от 26/03/2020", "Стойка 123768.5", "1350/14464GB"]) {
    assert.equal(extractExcelInventoryReferences(description).length, 0, description);
  }
});

test("broad audit evidence preserves the strict identifiers used for 1C publication and leaves input data intact", () => {
  const item: AuditItem = { id: "stand", name: "Лабораторный стенд", inventoryNumber: "123/768", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const asset = { externalId: "source", code: null, inventoryNumber: "№123768", barcode: null, name: "Лабораторный стенд", status: "Не в учёте" } as OneCFixedAsset;
  const inputs = { item, asset };
  const before = structuredClone(inputs);
  const strictBefore = matchOneCFixedAssetIdentifiers(asset, { items: [item] });
  const row = buildInventorySourceAudit([item], [{ externalId: asset.externalId, asset }], [], []).rows[0];
  assert.equal(row.source, "1c");
  assert.equal(auditNeedsReview(row), true);
  assert.deepEqual(strictBefore.inventoryItemIds, []);
  assert.deepEqual(strictBefore.barcodeItemIds, []);
  assert.deepEqual(matchOneCFixedAssetIdentifiers(asset, { items: [item] }), strictBefore);
  assert.deepEqual(inputs, before);
});
