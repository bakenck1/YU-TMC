import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parseMaterialSnapshot, parseStoredMaterialSnapshot } from "../lib/server/material-snapshot";

function sourceFile(invalidOnly = false): Buffer {
  const header = Array(12).fill(""); header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
  const row = (index: number, description: string) => {
    const cells = Array(12).fill(""); cells[0] = index; cells[1] = description; cells[11] = 0;
    return cells;
  };
  const lines = invalidOnly ? [header, row(1, "№1350/14464.5")] : [header, row(1, "Планшет Samsung Galaxy Tab 1350/14464 от 26.03.20"), row(2, "Плита инв.№206/486-487 15 этаж"), row(3, "Скотч 48/300")];
  if (!invalidOnly) lines[10_000] = row(4, "Принтер №050-0002223 от 15.02.13");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(lines), "Лист_1");
  return Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
}

test("reads through the complete XLS and preserves description and range evidence", () => {
  const parsed = parseMaterialSnapshot(sourceFile());
  assert.equal(parsed.skipped, 1);
  assert.deepEqual(parsed.accepted.map((row) => row.rowNumber), [2, 3, 10_001]);
  assert.equal(parsed.accepted[0].numberIsUnmarked, true);
  assert.equal(parsed.accepted[1].sourceInventoryNumber, "206/486-487");
  assert.equal(parsed.accepted[1].inventoryNumber, "206/486");
  assert.equal(parsed.accepted[2].inventoryNumber, "050-0002223");
  assert.equal(parsed.accepted[0].endingBalance, "0");
});

test("stored source reparsing rejects a changed hash, size or missing bytes", () => {
  const bytes = sourceFile();
  const parsed = parseMaterialSnapshot(bytes);
  const stored = { source_file: bytes, byte_size: bytes.length, sha256: parsed.sha256.toLowerCase() };
  assert.deepEqual(parseStoredMaterialSnapshot(stored), parsed);
  for (const invalid of [{ ...stored, sha256: "0".repeat(64) }, { ...stored, byte_size: bytes.length + 1 }, { ...stored, source_file: null }]) {
    assert.throws(() => parseStoredMaterialSnapshot(invalid), /material_snapshot_integrity_mismatch/u);
  }
});

test("an existing snapshot remains readable when stricter extraction rejects all its former numbers", () => {
  const bytes = sourceFile(true);
  assert.throws(() => parseMaterialSnapshot(bytes), /material_snapshot_no_inventory_numbers/u);
  const stored = parseStoredMaterialSnapshot({ source_file: bytes, byte_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  assert.equal(stored.accepted.length, 0);
  assert.equal(stored.skipped, 1);
});
