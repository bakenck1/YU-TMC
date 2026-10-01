import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";
import { exportInventorySourceAuditExcel } from "../lib/server/excel/inventory-source-audit-excel";

test("audit workbook mirrors item rows, retains duplicate details and writes untrusted cells as text", async () => {
  const bytes = await exportInventorySourceAuditExcel({
    run: { batch_id: "batch-1", batch_version: 4, batch_sha256: "a".repeat(64), one_c_registry_sha256: "c".repeat(64), filename: "материалы 2026.xls", sha256: "b".repeat(64), run_at: new Date("2026-10-01T08:00:00Z"), counts: { total: 1, oneCOnly: 0, excelOnly: 1, both: 0, missing: 0, temporary: 0 } },
    rows: [{ itemId: "item-1", itemName: "Ноутбук", siteNumber: "1350-00065", numberKind: "official", itemVersion: 1, result: "matched", source: "excel", oneC: [], excel: [{ rowNumber: 13, inventoryNumber: "1350-00065", nomenclature: "=HYPERLINK(\"bad\")", endingBalance: "0" }, { rowNumber: 100, inventoryNumber: "1350-00065", nomenclature: "ноутбук", endingBalance: "0" }] }],
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(workbook.getWorksheet("Сводка")!.getCell("B7").value, "b".repeat(64));
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.rowCount, 2);
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("A2").value, "Найдено совпадение");
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("G2").value, "'=HYPERLINK(\"bad\")");
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.rowCount, 3);
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.getCell("C2").value, "Да");
});
