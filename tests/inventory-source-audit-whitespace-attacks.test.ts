import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { auditNeedsReview, buildInventorySourceAudit, extractExcelInventoryReferences, type AuditItem, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { matchOneCFixedAssetIdentifiers } from "../lib/one-c-reconciliation";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";
import { parseStoredMaterialSnapshot } from "../lib/server/material-snapshot";

function item(inventoryNumber: string, id = "item", officialBarcodes: string[] = []): AuditItem {
  return { id, name: "Ноутбук", inventoryNumber, inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes, version: 1 };
}

function asset(inventoryNumber: string | null, name = "Ноутбук", barcode: string | null = null) {
  const externalId = "external";
  return { externalId, asset: { externalId, code: null, inventoryNumber, barcode, name, status: "Принято к учёту" } as OneCFixedAsset };
}

function excel(nomenclature: string): ExcelSourceRow {
  const references = extractExcelInventoryReferences(nomenclature);
  assert.ok(references.length, `No references: ${nomenclature}`);
  return { rowNumber: 2, nomenclature, ...references[0], inventoryReferences: references, endingBalance: "1" };
}

test("internal Unicode whitespace in a complete 1C inventory field is found in either direction", () => {
  for (const whitespace of [" ", "\u00a0", "\u202f", "\t", "\u2009"]) {
    for (const [siteNumber, sourceNumber] of [["241100388", `2411${whitespace}00388`], [`2411${whitespace}00388`, "241100388"]]) {
      const row = buildInventorySourceAudit([item(siteNumber)], [asset(sourceNumber)], [], []).rows[0];
      assert.equal(row.source, "1c", JSON.stringify({ siteNumber, sourceNumber }));
      assert.ok(row.oneC[0].matchedBy.includes("number_spaces"));
      assert.equal(row.oneC[0].inventoryNumber, sourceNumber);
      assert.equal(auditNeedsReview(row), true);
    }
  }
});

test("spaced identifiers in Excel and 1C descriptions keep raw evidence and find one card", () => {
  const description = "Ноутбук Lenovo IdeaPad №2411\u202f00388 от 15.04.24";
  const row = buildInventorySourceAudit([item("241100388")], [asset(null, description)], [excel(description)], []).rows[0];
  assert.equal(row.source, "1c+excel");
  assert.ok(row.oneC[0].matchedBy.includes("number_spaces"));
  assert.ok(row.excel[0].matchedBy?.includes("number_spaces"));
  assert.equal(row.excel[0].matchedInventoryNumber, "2411 00388");
  assert.equal(row.excel[0].nomenclature, description);
  assert.equal(row.oneC[0].name, description);
  assert.equal(auditNeedsReview(row), true);
});

test("spaces inside digits and around an inventory slash preserve the exact separator and digits", () => {
  const description = "Ноутбук №1350 / 14 464 от 15.04.24";
  const row = buildInventorySourceAudit([item("1350/14464")], [asset("1350 / 14 464")], [excel(description)], []).rows[0];
  assert.equal(row.source, "1c+excel");
  assert.ok(row.excel[0].matchedBy?.includes("number_spaces"));
  assert.ok(row.oneC[0].matchedBy.includes("number_spaces"));
  assert.equal(row.excel[0].matchedInventoryNumber, "1350 / 14 464");
});

test("an unmarked spaced description supplies the complete identifier, never its trailing fragment", () => {
  const description = "Ноутбук Lenovo IdeaPad 2411 00388 от 15.04.24";
  const references = extractExcelInventoryReferences(description);
  assert.deepEqual(references, [{ inventoryNumber: "2411 00388", numberIsUnmarked: true }]);
  const audit = buildInventorySourceAudit([item("241100388", "full"), item("00388", "fragment")], [asset(null, description)], [excel(description)], []);
  assert.equal(audit.rows.find((row) => row.itemId === "full")?.source, "1c+excel");
  assert.equal(audit.rows.find((row) => row.itemId === "fragment")?.source, null);
});

test("an official numeric barcode with internal spaces supplies reviewable complete-number evidence", () => {
  const row = buildInventorySourceAudit([item("OTHER", "barcode-item", ["*YUB-2411 00388*"])], [asset("241100388")], [excel("Ноутбук №241100388")], []).rows[0];
  assert.equal(row.source, "1c+excel");
  assert.ok(row.oneC[0].matchedBy.includes("number_spaces"));
  assert.deepEqual(row.oneC[0].matchedBarcodes, ["*YUB-2411 00388*"]);
  assert.deepEqual(row.excel[0].matchedBarcodes, ["*YUB-2411 00388*"]);
  assert.equal(auditNeedsReview(row), true);
});

test("whitespace matching never drops leading zeroes, changes separators, drops group suffixes, or joins letters", () => {
  const rows = buildInventorySourceAudit([
    item("2411003880", "substring"),
    item("0241100388", "zero"),
    item("2411-00388", "separator"),
    item("241100389", "different"),
    item("241100388-0001", "member"),
    item("X2411 00388", "letters"),
  ], [asset("2411 00388")], [excel("Ноутбук №2411 00388")], []).rows;
  assert.ok(rows.every((row) => row.source === null));
});

test("spaced description evidence never incorporates dates, floor numbers, quantities, or model suffixes", () => {
  assert.equal(excel("Ноутбук №2411 00388 15 этаж").inventoryNumber, "2411 00388");
  assert.equal(excel("Ноутбук №2411 00388 1 шт").inventoryNumber, "2411 00388");
  for (const description of ["Модель X2411 00388", "Модель 2411 00388GB", "от 2026 10 05", "от 15.04.24", "Габариты 123 456 мм"]) {
    const references = extractExcelInventoryReferences(description);
    const row = buildInventorySourceAudit([item("241100388")], [], references.map((entry) => ({ rowNumber: 2, nomenclature: description, ...entry, endingBalance: "1" })), []).rows[0];
    assert.equal(row.source, null, description);
  }
  for (const description of ["Модель X2411 00388", "Модель 2411 00388GB", "от 2026 10 00388"]) {
    const references = extractExcelInventoryReferences(description);
    const row = buildInventorySourceAudit([item("00388")], [], references.map((entry) => ({ rowNumber: 2, nomenclature: description, ...entry, endingBalance: "1" })), []).rows[0];
    assert.equal(row.source, null, description);
  }
});

test("a suffixed spaced numeric token never supplies a truncated marked or unmarked prefix", () => {
  for (const marker of ["№", "инв.", "No.", "N", ""]) {
    for (const suffix of ["GB", ".5", "-ABC", "/ABC"]) {
      const description = `Ноутбук ${marker}2411 00388 0001${suffix}`;
      const references = extractExcelInventoryReferences(description);
      assert.deepEqual(references, [], description);
      const row = buildInventorySourceAudit([item("241100388")], [asset(null, description)],
        references.map((entry) => ({ rowNumber: 2, nomenclature: description, ...entry, endingBalance: "1" })), []).rows[0];
      assert.equal(row.source, null, description);
    }
  }
});

test("whitespace audit keeps publication identities strict and all caller inputs intact", () => {
  const site = item("241100388");
  const source = asset("2411 00388");
  const input = { site, source };
  const before = structuredClone(input);
  const strict = matchOneCFixedAssetIdentifiers(source.asset, { items: [site] });
  assert.equal(strict.status, "possible_match");
  assert.deepEqual(strict.inventoryItemIds, []);
  assert.deepEqual(strict.matchedBy, []);
  assert.equal(buildInventorySourceAudit([site], [source], [], []).rows[0].source, "1c");
  assert.deepEqual(matchOneCFixedAssetIdentifiers(source.asset, { items: [site] }), strict);
  assert.deepEqual(input, before);
});

test("spaced inventory identifiers are found from immutable XLS bytes after a fresh dry-run", () => {
  const description = "Ноутбук Lenovo IdeaPad №2411\u202f00388 от 15.04.24";
  const header = Array(12).fill("");
  header[1] = "Номенклатура";
  header[4] = "Код";
  header[11] = "Количество";
  const cells = Array(12).fill("");
  cells[0] = 1;
  cells[1] = description;
  cells[11] = 1;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, cells]), "Лист_1");
  const bytes = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
  const original = Buffer.from(bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const parsed = parseStoredMaterialSnapshot({ source_file: bytes, byte_size: bytes.length, sha256: hash });
  const audit = buildInventorySourceAudit([item("241100388")], [], parsed.accepted, []);
  assert.equal(audit.rows[0].source, "excel");
  assert.ok(audit.rows[0].excel[0].matchedBy?.includes("number_spaces"));
  assert.equal(audit.rows[0].excel[0].nomenclature, description);
  assert.equal(audit.counts.possible, 1);
  assert.deepEqual(bytes, original);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
});
