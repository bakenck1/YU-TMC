import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";
import { exportOneCAnalyticsExcel } from "../lib/server/excel/one-c-analytics-excel";
import { summarizeOneCAudit } from "../lib/one-c-analytics";
import type { AuditMatch } from "../lib/inventory-source-audit";
import type { OneCMaterial } from "../lib/contracts/one-c-materials";
import { workbookCell as cell, workbookColumn as column, workbookRow as findRow } from "./helpers/one-c-workbook";

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
    rows, inventory: rows.map(item => ({ id: item.itemId, quantity: 2, status: "active", oneCCode: null as string | null, unitPrice: "123.45", responsibleName: "Ответственный Inventory" })),
    assets: rows.flatMap(row => row.oneC.map(source => ({ externalId: source.externalId, origins: ["current_registry" as const], asset: { externalId: source.externalId, code: source.code, inventoryNumber: source.inventoryNumber, name: source.name, barcode: source.barcode, category: null, location: null, status: source.status, responsibleName: null, responsibleExternalId: null, quantity: 1, initialCost: "900.5", residualCost: "450.25", acceptedAt: null, updatedAt: null } }))),
    materialRecords: [{ key: "mp1", material: { ...mp, inventoryNumber: "0000456" } }, { key: "mp2", material: { ...mp, inventoryNumber: "0000456", quantity: "1", warehouseCode: "002", unitPrice: "101.25" } }, { key: "mp3", material: { ...mp, code: "00003", inventoryNumber: "0000789", quantity: "1" } }],
  };
}
async function read(data: Parameters<typeof exportOneCAnalyticsExcel>[0]) {
  const bytes = await exportOneCAnalyticsExcel(data);
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return workbook;
}

test("six ordered full lists preserve IDs and balances, count confirmed cards once, and overlap temporary correctly", async () => {
  const workbook = await read(snapshot());
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["ОС", "МП", "Совпадения 1С", "Временные", "Не найдено в 1С", "Добавить в базу"]);
  assert.equal(cell(workbook.getWorksheet("ОС")!, "Код 1С").value, "00001");
  assert.equal(cell(workbook.getWorksheet("ОС")!, "Инвентарный номер").value, "0000123");
  const materials = workbook.getWorksheet("МП")!;
  assert.equal(materials.rowCount, 10); // Three source balances, then two matched Inventory cards.
  assert.equal(cell(materials, "Тип строки", 8).value, "Остаток 1С");
  assert.equal(cell(materials, "Тип строки", 9).value, "Карточка нашей базы");
  assert.deepEqual([cell(materials, "ID карточки", 9).value, cell(materials, "ID карточки", 10).value].sort(), ["both", "mp"]);
  const firstMaterial = findRow(materials, "00002", "Код 1С").number;
  assert.equal(cell(materials, "Остаток", firstMaterial).value, 1);
  assert.equal(cell(materials, "Учётная цена, KZT", firstMaterial).value, 101.25);
  assert.match(String(materials.getCell("A3").value), /Активные позиции 1С: 5 = ОС 3 \+ МП 2/);
  assert.match(String(materials.getCell("A2").value), /2 кодов МП.*3 строк остатков/);
  const found = workbook.getWorksheet("Совпадения 1С")!;
  assert.equal(found.rowCount, 9);
  assert.match(String(found.getCell("A2").value), /Найдено: 3\. Нужно сверить номер: 1/);
  const weak = findRow(found, "weak").number;
  assert.equal(cell(found, "Результат сверки", weak).value, "Нужно сверить номер");
  assert.equal(cell(found, "Раздел 1С", findRow(found, "both").number).value, "МП");
  assert.match(String(found.getCell("A2").value), /ОС: 1 · МП: 2/);
  const osRow = findRow(found, "os").number;
  assert.equal(cell(found, "Цена в нашей базе, KZT", osRow).value, 123.45);
  assert.equal(cell(found, "Ответственный в нашей базе", osRow).value, "Ответственный Inventory");
  assert.equal(cell(found, "Первоначальная стоимость ОС, KZT", osRow).value, 900.5);
  assert.equal(cell(found, "Остаточная стоимость ОС, KZT", osRow).value, 450.25);
  assert.equal(cell(found, "Цены строк МП, KZT", findRow(found, "mp").number).value, "100.25\n101.25");
  assert.equal(cell(found, "Первоначальная стоимость ОС, KZT", weak).value, null);
  assert.equal(cell(found, "Цены строк МП, KZT", weak).value, null);
  const temporary = workbook.getWorksheet("Временные")!;
  assert.equal(temporary.rowCount, 7);
  assert.equal(cell(temporary, "Результат сверки", findRow(temporary, "both").number).value, "Найдено");
  assert.equal(cell(temporary, "Раздел 1С", findRow(temporary, "both").number).value, "МП");
  const absentRow = findRow(temporary, "missing").number;
  assert.equal(cell(temporary, "Результат сверки", absentRow).value, "Не найдено");
  const missing = workbook.getWorksheet("Не найдено в 1С")!;
  assert.equal(missing.rowCount, 5);
  assert.equal(cell(temporary, "Наименование в нашей базе", absentRow).value, '\'=HYPERLINK("bad")');
  // The three Inventory sheets cover all cards; unmatched temporary cards are never listed as missing.
  const exportedIds = [found, missing, temporary].flatMap(sheet => Array.from({ length: sheet.rowCount - 5 }, (_, index) => cell(sheet, "ID карточки", index + 6).value));
  assert.deepEqual([...new Set(exportedIds)].sort(), snapshot().rows.map(row => row.itemId).sort());
  for (const sheet of workbook.worksheets) {
    assert.ok(sheet.autoFilter);
    assert.equal(sheet.views[0].state, "frozen");
    assert.equal(sheet.views[0].xSplit, 3);
    assert.match(String(sheet.getCell("A5").value), /^Ответственный/u);
    assert.match(String(sheet.getCell("B5").value), /стоимость|[Цц]ена/u);
    assert.match(String(sheet.getCell("C5").value), /^Наименование/u);
    assert.match(String(sheet.getCell("D5").value), /^Код 1С/u);
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
  assert.equal(cell(workbook.getWorksheet("Временные")!, "Результат сверки").value, "Нет данных для сверки");
  assert.equal(workbook.getWorksheet("Добавить в базу")!.rowCount, 5);
  assert.match(String(workbook.getWorksheet("Не найдено в 1С")!.getCell("A4").value), /Нет данных ОС и МП/);
});

test("partial sources explicitly scope missing results and exports do not stop at a page boundary", async () => {
  const data = snapshot();
  data.rows.push(...Array.from({ length: 150 }, (_, i) => row(`extra${i}`)));
  data.assets.push(...Array.from({ length: 150 }, (_, i) => ({ ...data.assets[0], externalId: `asset${i}`, asset: { ...data.assets[0].asset, code: `000${i}`, name: `ОС ${i}` } })));
  data.analytics.assets.total = data.assets.length;
  const workbook = await read({ ...data, materials: { ...data.materials, batchId: null }, materialRecords: [] });
  const missing = workbook.getWorksheet("Не найдено в 1С")!;
  assert.equal(missing.rowCount, 155);
  assert.equal(workbook.getWorksheet("ОС")!.rowCount, 158);
  assert.ok(findRow(workbook.getWorksheet("ОС")!, "000149", "Код 1С"));
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
  assert.equal(sheet.rowCount, 160);
  const extra = findRow(sheet, "M149", "Код 1С").number;
  assert.equal(cell(sheet, "Ответственный", extra).value, "Ответственный 149");
  assert.match(String(sheet.getCell("A2").value), /152 кодов МП с положительным остатком · 153 строк/);
});

test("temporary sheet keeps saved 1C codes beside owner, price and name as text, including unmatched cards", async () => {
  const data = snapshot();
  data.inventory.find(item => item.id === 'both')!.oneCCode = '00000011188';
  data.inventory.find(item => item.id === 'missing')!.oneCCode = '000009149';
  const book = await read(data);
  const sheet = book.getWorksheet('Временные')!;
  assert.equal(column(sheet, 'Код 1С в нашей базе'), 4);
  assert.equal(cell(sheet, 'Код 1С в нашей базе', findRow(sheet, 'both').number).value, '00000011188');
  const absentRow = findRow(sheet, 'missing').number;
  assert.equal(cell(sheet, 'Код 1С в нашей базе', absentRow).value, '000009149');
  assert.equal(cell(sheet, 'Результат сверки', absentRow).value, 'Не найдено');
  assert.equal(cell(sheet, 'Коды ОС', absentRow).value, '');
  data.inventory.find(item => item.id === 'missing')!.oneCCode = null;
  const absent = await read(data);
  const missingSheet = absent.getWorksheet('Временные')!;
  assert.equal(cell(missingSheet, 'Код 1С в нашей базе', findRow(missingSheet, 'missing').number).value, '');
});

test("add-to-database sheet includes every absent active source, preserves balances and excludes even weak candidates", async () => {
  const data = snapshot();
  data.assets.push(
    { ...data.assets[0], externalId: "absent-os", asset: { ...data.assets[0].asset, externalId: "absent-os", code: "00000099", name: "Новое ОС", responsibleName: "Алия Иванова", initialCost: "900.50" } },
    { ...data.assets[0], externalId: "aggregate-os", asset: { ...data.assets[0].asset, externalId: "aggregate-os", code: "00000100", name: "Групповое ОС", responsibleName: "Алия Иванова", quantity: 2, initialCost: "5000" } },
  );
  data.materialRecords.push(
    { key: "absent-mp-1", material: { ...mp, code: "00000088", name: "Новый МП", responsibleName: "Борис Иванов", quantity: "2.5", unitPrice: "200" } },
    { key: "absent-mp-2", material: { ...mp, code: "00000088", name: "Новый МП", responsibleName: "Борис Иванов", warehouseCode: "002", quantity: "1", unitPrice: "300" } },
  );
  const book = await read(data);
  const sheet = book.getWorksheet("Добавить в базу")!;
  assert.equal(sheet.rowCount, 9);
  assert.match(String(sheet.getCell("A2").value), /2 ОС · 2 строк остатков МП/u);
  assert.equal(cell(sheet, "Код 1С").value, "00000099");
  assert.equal(cell(sheet, "Цена за единицу, KZT").value, 900.5);
  const aggregate = findRow(sheet, "00000100", "Код 1С").number;
  assert.equal(cell(sheet, "Цена за единицу, KZT", aggregate).value, null);
  assert.equal(cell(sheet, "Первоначальная стоимость ОС, KZT", aggregate).value, 5000);
  assert.equal(cell(sheet, "Цена за единицу, KZT", 8).value, 300);
  assert.equal(cell(sheet, "Цена за единицу, KZT", 9).value, 200);
  assert.equal(cell(sheet, "Количество", 9).value, 2.5);
  assert.equal(cell(sheet, "Код 1С", 9).value, "00000088");
  assert.equal(cell(sheet, "№", 9).value, 4);
  assert.equal(sheet.getCell("B8").numFmt, '#,##0.00');
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => cell(sheet, "Ключ строки 1С", index + 6).value), ["absent-os", "aggregate-os", "absent-mp-2", "absent-mp-1"]);
});

test("all sheets group owners then descending prices, retain zero prices and put unassigned records last", async () => {
  const data = snapshot();
  data.materialRecords = [
    { key: "unassigned", material: { ...mp, code: "001", responsibleName: null, unitPrice: "999999" } },
    { key: "low", material: { ...mp, code: "002", responsibleName: "Алия Иванова", unitPrice: "0" } },
    { key: "high", material: { ...mp, code: "003", responsibleName: "Алия Иванова", unitPrice: "300.25" } },
    { key: "middle", material: { ...mp, code: "004", responsibleName: "Алия Иванова", unitPrice: "100" } },
    { key: "other", material: { ...mp, code: "005", responsibleName: "Борис Иванов", unitPrice: "900" } },
  ];
  const book = await read(data);
  for (const name of ["МП", "Добавить в базу"]) {
    const sheet = book.getWorksheet(name)!;
    assert.deepEqual(Array.from({ length: 5 }, (_, index) => cell(sheet, "Код 1С", index + 6).value), ["003", "004", "002", "005", "001"]);
    assert.equal(sheet.getCell("B8").value, 0);
    assert.equal(sheet.getCell("B6").numFmt, '#,##0.00');
    assert.equal(sheet.getCell("D6").type, 3); // Text, preserving leading zeroes.
    assert.equal(sheet.getCell("B6").font.bold, true);
  }
});

test("absent source export has no page limit and includes only available registers", async () => {
  const data = snapshot();
  data.materialRecords.push(...Array.from({ length: 155 }, (_, index) => ({ key: `absent-${index}`, material: { ...mp, code: `0000${index}` } })));
  const book = await read({ ...data, assets: [], analytics: { ...data.analytics, assets: { ...data.analytics.assets, receivedAt: null } } });
  const sheet = book.getWorksheet("Добавить в базу")!;
  assert.equal(sheet.rowCount, 160);
  assert.ok(findRow(sheet, "0000154", "Код 1С"));
  assert.equal(cell(sheet, "Раздел 1С").value, "МП");
});
