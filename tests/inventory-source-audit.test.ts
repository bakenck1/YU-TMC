import assert from "node:assert/strict";
import test from "node:test";
import { buildInventorySourceAudit, extractExcelInventoryNumber, type AuditItem, type ExcelSourceRow } from "../lib/inventory-source-audit";
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
  assert.deepEqual(audit.counts, { total: 4, oneCOnly: 0, excelOnly: 1, both: 1, missing: 2, temporary: 1 });
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
  assert.equal(buildInventorySourceAudit([{ ...base, officialBarcodes: ["YUI-1234567890ABCDEF"] }], [], excel, []).rows[0].source, null);
});
