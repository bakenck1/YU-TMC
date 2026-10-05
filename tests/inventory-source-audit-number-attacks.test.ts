import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  auditNeedsReview,
  buildInventorySourceAudit,
  extractExcelInventoryReferences,
  type AuditItem,
  type ExcelSourceRow,
} from "../lib/inventory-source-audit";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { parseMaterialSnapshot, parseStoredMaterialSnapshot } from "../lib/server/material-snapshot";
import { matchOneCFixedAssetIdentifiers } from "../lib/one-c-reconciliation";

function item(id: string, inventoryNumber: string, name = "Скамья 2-хместн."): AuditItem {
  return { id, name, inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [inventoryNumber], version: 1 };
}

function excel(description: string, rowNumber = 786): ExcelSourceRow {
  const references = extractExcelInventoryReferences(description);
  assert.ok(references.length, `No inventory reference parsed from ${description}`);
  return { rowNumber, nomenclature: description, ...references[0], inventoryReferences: references, endingBalance: "1" };
}

test("screenshot bench finds the complete Excel identifier as reviewable evidence for the site stem", () => {
  const description = "Скамья 2-хместн. №050-0002082-97 от 15.09.12";
  const audit = buildInventorySourceAudit([item("bench", "050-0002082")], [], [excel(description)], []);
  assert.equal(audit.rows[0].source, "excel");
  assert.equal(audit.rows[0].excel[0].rowNumber, 786);
  assert.equal(audit.rows[0].excel[0].nomenclature, description);
  assert.equal(auditNeedsReview(audit.rows[0]), true, "A suffix difference must remain reviewable instead of becoming an exact identity");
});

test("a complete hyphenated Excel identifier still matches its full site number exactly", () => {
  const audit = buildInventorySourceAudit([item("full", "050-0002082-97")], [], [excel("Скамья 2-хместн. №050-0002082-97 от 15.09.12")], []);
  assert.equal(audit.rows[0].source, "excel");
  assert.equal(auditNeedsReview(audit.rows[0]), false);
});

test("a suffix difference in a 1C description is shown as a possible identifier match", () => {
  const description = "Скамья 2-хместн. №050-0002082-97 от 15.09.12";
  const externalId = "bench-source";
  const asset = { externalId, code: null, inventoryNumber: null, barcode: null, name: description, status: "Принято к учёту" } as OneCFixedAsset;
  const audit = buildInventorySourceAudit([item("bench", "050-0002082")], [{ externalId, asset }], [], []);
  assert.equal(audit.rows[0].source, "1c");
  assert.equal(audit.rows[0].oneC[0].name, description);
  assert.equal(auditNeedsReview(audit.rows[0]), true);
});

test("spaces around an inventory slash do not hide the same complete number", () => {
  const audit = buildInventorySourceAudit([item("slash", "1350/00065", "Стол")], [], [excel("Стол №1350 / 00065 от 15.09.12")], []);
  assert.equal(audit.rows[0].source, "excel");
  assert.equal(audit.rows[0].excel[0].nomenclature, "Стол №1350 / 00065 от 15.09.12");
});

test("dash typography variants retain the full source and find the same reviewable stem", () => {
  for (const dash of ["–", "—", "‑"]) {
    const description = `Скамья 2-хместн. №050${dash}0002082${dash}97 от 15.09.12`;
    const audit = buildInventorySourceAudit([item("bench", "050-0002082")], [], [excel(description)], []);
    assert.equal(audit.rows[0].source, "excel", description);
    assert.equal(audit.rows[0].excel[0].nomenclature, description);
    assert.equal(auditNeedsReview(audit.rows[0]), true);
  }
});

test("broader suffix discovery never drops leading zeroes, expands a substring, or matches a name alone", () => {
  const excelRow = excel("Скамья 2-хместн. №050-0002082-97 от 15.09.12");
  const audit = buildInventorySourceAudit([
    item("zeros", "50-2082"),
    item("substring", "050-000208"),
    item("different", "050-0002083"),
    item("name", "999-9999999"),
    item("suffix", "97"),
  ], [], [excelRow], []);
  assert.equal(audit.counts.missing, 5);
  assert.ok(audit.rows.every((row) => row.source === null));
});

test("local group member suffixes and two distinct complete suffixes never collapse into one item", () => {
  const audit = buildInventorySourceAudit([
    item("group", "1350-00065-0001"),
    item("different-suffix", "050-0002082-98"),
    item("group-base", "1350-00066"),
  ], [], [excel("Скамья №1350-00065", 2), excel("Скамья №050-0002082-97", 3), excel("Скамья №1350-00066-0001", 4)], []);
  assert.equal(audit.counts.missing, 3);
  assert.ok(audit.rows.every((row) => row.source === null));
});

test("the screenshot fixture is found after reparsing an immutable stored XLS source", () => {
  const description = "Скамья 2-хместн. №050-0002082-97 от 15.09.12";
  const header = Array(12).fill("");
  header[1] = "Номенклатура";
  header[4] = "Код";
  header[11] = "Количество";
  const cells = Array(12).fill("");
  cells[0] = 733;
  cells[1] = description;
  cells[11] = 1;
  const lines: unknown[][] = [header];
  lines[785] = cells;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(lines), "Лист_1");
  const source = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
  const preservedBytes = Buffer.from(source);
  const hash = createHash("sha256").update(source).digest("hex");
  const uploaded = parseMaterialSnapshot(source);
  const reparsed = parseStoredMaterialSnapshot({ source_file: source, byte_size: source.length, sha256: hash });
  assert.deepEqual(reparsed, uploaded);
  assert.equal(reparsed.accepted[0].inventoryNumber, "050-0002082-97", "Do not rewrite the source identity to the proposed stem");
  const audit = buildInventorySourceAudit([item("bench", "050-0002082")], [], reparsed.accepted, []);
  assert.equal(audit.rows[0].source, "excel");
  assert.equal(audit.rows[0].excel[0].rowNumber, 786);
  assert.equal(audit.rows[0].excel[0].nomenclature, description);
  assert.equal(auditNeedsReview(audit.rows[0]), true);
  assert.deepEqual(source, preservedBytes);
  assert.equal(createHash("sha256").update(source).digest("hex"), hash);
});

test("a suffix candidate is read-only and cannot become an exact 1C publication link", () => {
  const items = [item("bench", "050-0002082")];
  const asset = { externalId: "bench-source", code: null, inventoryNumber: "050-0002082-97", barcode: "050-0002082-97", name: "Скамья", status: "Принято к учёту" } as OneCFixedAsset;
  const beforeItems = structuredClone(items);
  const beforeAsset = structuredClone(asset);
  const audit = buildInventorySourceAudit(items, [{ externalId: asset.externalId, asset }], [], []);
  assert.equal(audit.rows[0].source, "1c");
  assert.deepEqual(audit.rows[0].oneC[0].matchedBy, ["number_suffix"]);
  assert.equal(auditNeedsReview(audit.rows[0]), true);
  const publication = matchOneCFixedAssetIdentifiers(asset, { items });
  assert.equal(publication.status, "new_candidate");
  assert.equal(publication.itemId, null);
  assert.deepEqual(publication.matchedBy, []);
  assert.deepEqual(items, beforeItems);
  assert.deepEqual(asset, beforeAsset);
});
