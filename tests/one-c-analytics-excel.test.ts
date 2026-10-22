import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";
import { exportOneCAnalyticsExcel } from "../lib/server/excel/one-c-analytics-excel";
import { summarizeOneCAudit } from "../lib/one-c-analytics";
import type { AuditMatch } from "../lib/inventory-source-audit";
import type { OneCMaterial } from "../lib/contracts/one-c-materials";

const asset: AuditMatch["oneC"][number] = { externalId: "os1", name: "Стол", inventoryNumber: "0000123", code: "00001", barcode: null, status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["inventory_number"], matchedBarcodes: [] };
const material: AuditMatch["excel"][number] = { sourceKind: "materials_api", sourceKey: "mp1", oneCCode: "00002", rowNumber: 1, nomenclature: "Стол", inventoryNumber: "0000456", explicitInventoryNumber: "0000456", endingBalance: "2", matchedBy: ["site_number"] };
const row = (id: string, rest: Partial<AuditMatch> = {}): AuditMatch => ({ itemId: id, itemName: "Стол", siteNumber: "0000123", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: null, oneC: [], excel: [], ...rest });
const mp: OneCMaterial = { code: "00002", name: "Материал", externalId: null, warehouseExternalId: null, warehouseCode: null, warehouseName: null, inventoryNumber: "0000123", barcode: null, unit: "шт", quantity: "2.5", unitPrice: "100.25", currency: "KZT" };

function snapshot() {
  const rows = [
    row("os", { oneC: [asset] }),
    row("mp", { siteNumber: "0000456", excel: [material, { ...material, rowNumber: 2, sourceKey: "mp2" }] }),
    row("both", { siteNumber: "TMP-1", siteBarcodes: [{ value: "0000789", kind: "official" }], oneC: [{ ...asset, externalId: "os2", inventoryNumber: "0000789" }], excel: [{ ...material, oneCCode: "00003", rowNumber: 3, sourceKey: "mp3", inventoryNumber: "0000789", explicitInventoryNumber: "0000789" }], numberKind: "temporary" }),
    row("weak", { siteNumber: "0000999", oneC: [{ ...asset, externalId: "weak-os", inventoryNumber: "0000999-1", matchedBy: ["number_suffix"] }] }),
    row("missing", { result: "temporary", numberKind: "temporary", itemName: '=HYPERLINK("bad")' }),
  ];
  return {
    analytics: { calculatedAt: "2026-10-22T05:00:00Z", assets: { total: 3, active: 3, retired: 0, other: 0, receivedAt: "2026-10-22T05:00:00Z" }, inventory: { total: 5, active: 5, quantity: 10 }, reconciliation: summarizeOneCAudit(rows, ["os1", "os2", "weak-os"], ["mp1", "mp2", "mp3"]) },
    materials: { kind: "materials_api" as const, batchId: "b", receivedAt: null, snapshotAt: null, sha256: "test", rowCount: 3, materialCount: 2, positiveRows: 3, nonPositiveRows: 0 },
    rows, inventory: rows.map(item => ({ id: item.itemId, quantity: 2, status: "active", oneCCode: null, unitPrice: "123.45", responsibleName: "Ответственный Inventory" })),
    assets: rows.flatMap(row => row.oneC.map(source => ({ externalId: source.externalId, origins: ["current_registry" as const], asset: { externalId: source.externalId, code: source.code, inventoryNumber: source.inventoryNumber, name: source.name, barcode: source.barcode, category: null, location: null, status: source.status, responsibleName: null, responsibleExternalId: null, quantity: 1, residualCost: null, acceptedAt: null, updatedAt: null } }))),
    materialRecords: [{ key: "mp1", material: { ...mp, inventoryNumber: "0000456" } }, { key: "mp2", material: { ...mp, inventoryNumber: "0000456", quantity: "1", warehouseCode: "002" } }, { key: "mp3", material: { ...mp, code: "00003", inventoryNumber: "0000789", quantity: "1" } }],
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
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["ОС", "МП", "Совпадения 1С", "Временные", "Не найдено в 1С"]);
  assert.equal(workbook.getWorksheet("ОС")!.getCell("B6").value, "00001");
  assert.equal(workbook.getWorksheet("ОС")!.getCell("D6").value, "0000123");
  const materials = workbook.getWorksheet("МП")!;
  assert.equal(materials.rowCount, 8); // Every positive balance, not distinct-code or paginated rows.
  assert.equal(materials.getCell("F6").value, 2.5);
  assert.equal(materials.getCell("L6").value, 100.25);
  assert.match(String(materials.getCell("A3").value), /Всего в 1С: 5 активных позиций/);
  const found = workbook.getWorksheet("Совпадения 1С")!;
  assert.equal(found.rowCount, 9);
  assert.match(String(found.getCell("A2").value), /Найдено: 3\. Совпадение не подтверждено: 1/);
  assert.equal(found.getCell("G9").value, "Совпадение не подтверждено");
  assert.equal(found.getCell("B9").value, "weak");
  assert.equal(found.getCell("H8").value, "ОС + МП");
  assert.equal(found.getCell("Q6").value, 123.45);
  assert.equal(found.getCell("R6").value, "Ответственный Inventory");
  const temporary = workbook.getWorksheet("Временные")!;
  assert.equal(temporary.rowCount, 7);
  assert.equal(temporary.getCell("G6").value, "Найдено");
  assert.equal(temporary.getCell("G7").value, "Не найдено");
  const missing = workbook.getWorksheet("Не найдено в 1С")!;
  assert.equal(missing.rowCount, 6);
  assert.equal(missing.getCell("B6").value, "missing");
  assert.equal(missing.getCell("C6").value, '\'=HYPERLINK("bad")');
  // Every active card appears in the third or fifth sheet, including ambiguous identities.
  const exportedIds = [found, missing].flatMap(sheet => Array.from({ length: sheet.rowCount - 5 }, (_, index) => sheet.getCell(`B${index + 6}`).value));
  assert.deepEqual(exportedIds.sort(), snapshot().rows.map(row => row.itemId).sort());
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
  assert.equal(workbook.getWorksheet("Совпадения 1С")!.rowCount, 5);
  assert.equal(workbook.getWorksheet("Не найдено в 1С")!.rowCount, 5);
  assert.equal(workbook.getWorksheet("Временные")!.rowCount, 7);
  assert.equal(workbook.getWorksheet("Временные")!.getCell("G6").value, "Нет данных для сверки");
  assert.match(String(workbook.getWorksheet("Не найдено в 1С")!.getCell("A4").value), /Нет данных ОС и МП/);
});

test("partial sources explicitly scope missing results and exports do not stop at a page boundary", async () => {
  const data = snapshot();
  data.rows.push(...Array.from({ length: 150 }, (_, i) => row(`extra${i}`)));
  data.assets.push(...Array.from({ length: 150 }, (_, i) => ({ ...data.assets[0], externalId: `asset${i}`, asset: { ...data.assets[0].asset, code: `000${i}`, name: `ОС ${i}` } })));
  data.analytics.assets.total = data.assets.length;
  const workbook = await read({ ...data, materials: { ...data.materials, batchId: null }, materialRecords: [] });
  const missing = workbook.getWorksheet("Не найдено в 1С")!;
  assert.equal(missing.rowCount, 156);
  assert.equal(workbook.getWorksheet("ОС")!.rowCount, 158);
  assert.equal(workbook.getWorksheet("ОС")!.getCell("B158").value, "000149");
  assert.match(String(missing.getCell("A4").value), /Сверка только по ОС/);
});

test("the MP sheet includes every current balance beyond the registry page size", async () => {
  const data = snapshot();
  data.materialRecords.push(...Array.from({ length: 150 }, (_, index) => ({
    key: `mp-extra-${index}`, material: { ...mp, code: `M${index}`, name: `Материальный предмет ${index}`, responsibleName: `Ответственный ${index}` },
  })));
  data.materials.materialCount = 152;
  data.materials.rowCount = data.materialRecords.length;
  const workbook = await read(data);
  const sheet = workbook.getWorksheet("МП")!;
  assert.equal(sheet.rowCount, 158);
  assert.equal(sheet.getCell("B158").value, "M149");
  assert.equal(sheet.getCell("J158").value, "Ответственный 149");
  assert.match(String(sheet.getCell("A2").value), /152 активных позиций · 153 строк/);
});
