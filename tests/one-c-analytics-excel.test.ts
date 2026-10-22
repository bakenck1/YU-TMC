import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";
import { exportOneCAnalyticsExcel } from "../lib/server/excel/one-c-analytics-excel";
import { summarizeOneCAudit } from "../lib/one-c-analytics";
import type { AuditMatch } from "../lib/inventory-source-audit";
import type { OneCMaterial } from "../lib/contracts/one-c-materials";

const asset: AuditMatch["oneC"][number] = { externalId: "os1", name: "Стол", inventoryNumber: "0000123", code: "00001", barcode: null, status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["inventory_number"], matchedBarcodes: [] };
const material: AuditMatch["excel"][number] = { sourceKind: "materials_api", sourceKey: "mp1", oneCCode: "00002", rowNumber: 1, nomenclature: "Стол", inventoryNumber: "0000123", endingBalance: "2", matchedBy: ["code"] };
const row = (id: string, rest: Partial<AuditMatch> = {}): AuditMatch => ({ itemId: id, itemName: "Стол", siteNumber: "0000123", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: null, oneC: [], excel: [], ...rest });
const mp: OneCMaterial = { code: "00002", name: "Материал", externalId: null, warehouseExternalId: null, warehouseCode: null, warehouseName: null, inventoryNumber: "0000123", barcode: null, unit: "шт", quantity: "2.5", unitPrice: "100.25", currency: "KZT" };

function snapshot() {
  const rows = [
    row("os", { oneC: [asset] }),
    row("mp", { excel: [material, { ...material, sourceKey: "mp2" }] }),
    row("both", { oneC: [asset], excel: [material], numberKind: "temporary" }),
    row("weak", { oneC: [{ ...asset, matchedBy: ["number_without_slash"] }] }),
    row("missing", { result: "temporary", numberKind: "temporary", itemName: '=HYPERLINK("bad")' }),
  ];
  return {
    analytics: { calculatedAt: "2026-10-22T05:00:00Z", assets: { total: 1, active: 1, retired: 0, other: 0, receivedAt: "2026-10-22T05:00:00Z" }, inventory: { total: 5, active: 5, quantity: 10 }, reconciliation: summarizeOneCAudit(rows, ["os1"], ["mp1", "mp2"]) },
    materials: { kind: "materials_api" as const, batchId: "b", receivedAt: null, snapshotAt: null, sha256: "test", rowCount: 3, materialCount: 2, positiveRows: 2, nonPositiveRows: 1 },
    rows, inventory: rows.map(item => ({ id: item.itemId, quantity: 2, status: "active", oneCCode: null })),
    assets: [{ externalId: "os1", origins: ["current_registry" as const], asset: { externalId: "os1", code: "00001", inventoryNumber: "0000123", name: "Стол", barcode: null, category: null, location: null, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null, quantity: 1, residualCost: null, acceptedAt: null, updatedAt: null } }],
    materialRecords: [{ key: "mp1", material: mp }, { key: "mp2", material: { ...mp, quantity: "1", warehouseCode: "002" } }, { key: "zero", material: { ...mp, code: "00003", quantity: "0" } }],
  };
}
async function read(data: Parameters<typeof exportOneCAnalyticsExcel>[0]) {
  const bytes = await exportOneCAnalyticsExcel(data);
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return workbook;
}

test("five ordered full lists preserve IDs and balances, count confirmed cards once, and overlap temporary correctly", async () => {
  const workbook = await read(snapshot());
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["ОС", "МП", "Найдено в 1С", "Временные", "Не найдено в 1С"]);
  assert.equal(workbook.getWorksheet("ОС")!.getCell("B6").value, "00001");
  assert.equal(workbook.getWorksheet("ОС")!.getCell("D6").value, "0000123");
  const materials = workbook.getWorksheet("МП")!;
  assert.equal(materials.rowCount, 8); // All balances, including zero, not distinct-code or paginated rows.
  assert.equal(materials.getCell("F6").value, 2.5);
  assert.equal(materials.getCell("L6").value, 100.25);
  assert.equal(materials.getCell("F8").value, 0);
  assert.match(String(materials.getCell("A3").value), /Всего в 1С: 3 позиций/);
  const found = workbook.getWorksheet("Найдено в 1С")!;
  assert.equal(found.rowCount, 8);
  assert.match(String(found.getCell("A2").value), /3 карточек · 6 единиц/);
  assert.equal(found.getCell("H8").value, "ОС + МП");
  const temporary = workbook.getWorksheet("Временные")!;
  assert.equal(temporary.rowCount, 7);
  assert.equal(temporary.getCell("G6").value, "Найдено");
  assert.equal(temporary.getCell("G7").value, "Не найдено");
  const missing = workbook.getWorksheet("Не найдено в 1С")!;
  assert.equal(missing.rowCount, 6);
  assert.equal(missing.getCell("B6").value, "missing");
  assert.equal(missing.getCell("C6").value, '\'=HYPERLINK("bad")');
  for (const sheet of workbook.worksheets) {
    assert.ok(sheet.autoFilter);
    assert.equal(sheet.views[0].state, "frozen");
    sheet.eachRow(row => row.eachCell(cell => assert.equal(cell.formula, undefined)));
  }
});

test("unavailable sources do not turn local cards into false missing records; temporary list stays usable", async () => {
  const data = snapshot();
  const noSources = { ...data, assets: [], materialRecords: [], analytics: { ...data.analytics, assets: { ...data.analytics.assets, total: 0, receivedAt: null } }, materials: { ...data.materials, batchId: null, rowCount: 0, materialCount: 0 }, rows: data.rows.map(row => ({ ...row, oneC: [], excel: [] })) };
  const workbook = await read(noSources);
  assert.equal(workbook.getWorksheet("Найдено в 1С")!.rowCount, 5);
  assert.equal(workbook.getWorksheet("Не найдено в 1С")!.rowCount, 5);
  assert.equal(workbook.getWorksheet("Временные")!.rowCount, 7);
  assert.equal(workbook.getWorksheet("Временные")!.getCell("G6").value, "Нет данных для сверки");
  assert.match(String(workbook.getWorksheet("Не найдено в 1С")!.getCell("A4").value), /Нет данных ОС и МП/);
});

test("partial sources explicitly scope missing results and exports do not stop at a page boundary", async () => {
  const data = snapshot();
  data.rows.push(...Array.from({ length: 150 }, (_, i) => row(`extra${i}`)));
  const workbook = await read({ ...data, materials: { ...data.materials, batchId: null }, materialRecords: [] });
  const missing = workbook.getWorksheet("Не найдено в 1С")!;
  assert.equal(missing.rowCount, 156);
  assert.match(String(missing.getCell("A4").value), /Сверка только по ОС/);
});
