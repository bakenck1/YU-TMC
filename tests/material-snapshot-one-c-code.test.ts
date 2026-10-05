import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as XLSX from "xlsx";

import { parseMaterialSnapshot, parseStoredMaterialSnapshot } from "../lib/server/material-snapshot";

function sourceFile(codes: unknown[], codeHeader = "Код", formattedNumber: boolean | string = false, formulaCode = false): Buffer {
  const header = Array(12).fill("");
  header[1] = "Номенклатура";
  header[4] = codeHeader;
  header[11] = "Количество";
  const lines = [header, ...codes.map((code, index) => {
    const cells = Array(12).fill("");
    cells[0] = index + 1;
    cells[1] = `Ноутбук Lenovo IdeaPad №2411/${String(index + 388).padStart(5, "0")}`;
    cells[4] = code;
    cells[11] = 1;
    return cells;
  })];
  const sheet = XLSX.utils.aoa_to_sheet(lines);
  if (formattedNumber) sheet.E2.z = typeof formattedNumber === "string" ? formattedNumber : "00000000";
  // BIFF8 serializes the parsed formula record `bf`: a three-byte token payload
  // containing the integer literal 1. Its deliberately different cached value
  // must not be accepted as a literal source code.
  if (formulaCode) (sheet.E2 as XLSX.CellObject & { bf: number[] }).bf = [3, 0, 0x1e, 1, 0];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Лист_1");
  return Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
}

test("the existing material XLS code column survives upload and stored-byte reparsing with leading zeroes", () => {
  const bytes = sourceFile(["00003254", " 00003255 ", "А00003259", ""]);
  const before = Buffer.from(bytes);
  const parsed = parseMaterialSnapshot(bytes);
  assert.deepEqual(parsed.accepted.map((row) => row.oneCCode), ["00003254", "00003255", "А00003259", null]);
  assert.equal(parsed.accepted[0].rowNumber, 2);
  assert.equal(parsed.accepted[0].inventoryNumber, "2411/00388");
  assert.equal(parsed.accepted[0].nomenclature, "Ноутбук Lenovo IdeaPad №2411/00388");
  assert.deepEqual(bytes, before);
  assert.equal(parsed.sha256.toLowerCase(), createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(parseStoredMaterialSnapshot({ source_file: bytes, byte_size: bytes.length, sha256: parsed.sha256 }), parsed);
});

test("numeric code cells keep the display format and do not invent zeroes without one", () => {
  assert.equal(parseMaterialSnapshot(sourceFile([3254], "Код", true)).accepted[0].oneCCode, "00003254");
  assert.equal(parseMaterialSnapshot(sourceFile([3254])).accepted[0].oneCCode, "3254");
});

test("numeric codes retain their exact digits when Excel formats round, decorate or replace the displayed value", () => {
  for (const format of ["0.00E+00", "#,##0", "0.00"]) {
    assert.equal(parseMaterialSnapshot(sourceFile([3254], "Код", format)).accepted[0].oneCCode, "3254", format);
  }
  assert.equal(parseMaterialSnapshot(sourceFile([1234567890123])).accepted[0].oneCCode, "1234567890123");
  assert.equal(parseMaterialSnapshot(sourceFile([123], "Код", '"00003254"')).accepted[0].oneCCode, "123");
});

test("existing column positions accept the explicit 1C code header aliases", () => {
  for (const header of ["Код", "Код 1С", "Код1С", "Код 1C", "Код1C"]) {
    assert.equal(parseMaterialSnapshot(sourceFile(["00003254"], header)).accepted[0].oneCCode, "00003254", header);
  }
});

test("unsupported boolean codes stay absent and overlong codes are rejected before persistence", () => {
  const parsed = parseMaterialSnapshot(sourceFile([true, false, ""]));
  assert.deepEqual(parsed.accepted.map((row) => row.oneCCode), [null, null, null]);
  assert.throws(() => parseMaterialSnapshot(sourceFile(["0".repeat(65)])), /invalid_material_snapshot_file/u);
  assert.equal(parseMaterialSnapshot(sourceFile(["0".repeat(64)])).accepted[0].oneCCode, "0".repeat(64));
});

test("a real BIFF8 formula's cached code cannot be used for automatic identifier enrichment", () => {
  const bytes = sourceFile([3254], "Код", true, true);
  const read = XLSX.read(bytes, { type: "buffer", cellFormula: true });
  assert.equal(read.Sheets[read.SheetNames[0]].E2.f, "1");
  assert.equal(read.Sheets[read.SheetNames[0]].E2.v, 3254);
  assert.equal(parseMaterialSnapshot(bytes).accepted[0].oneCCode, null);
});
