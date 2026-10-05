import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";
import { exportInventorySourceAuditExcel } from "../lib/server/excel/inventory-source-audit-excel";
import { buildInventorySourceAudit, extractExcelInventoryReferences, type AuditItem, type AuditMatch, type ExcelSourceRow } from "../lib/inventory-source-audit";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";

test("audit workbook mirrors item rows, retains duplicate details and writes untrusted cells as text", async () => {
  const bytes = await exportInventorySourceAuditExcel({
    run: { batch_id: "batch-1", batch_version: 4, batch_sha256: "a".repeat(64), one_c_registry_sha256: "c".repeat(64), filename: "материалы 2026.xls", sha256: "b".repeat(64), run_at: new Date("2026-10-01T08:00:00Z"), counts: { total: 1, oneCOnly: 0, excelOnly: 1, both: 0, missing: 0, temporary: 0 } },
    rows: [{ itemId: "item-1", itemName: "Ноутбук", siteNumber: "1350-00065", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: "excel", oneC: [], excel: [{ rowNumber: 13, inventoryNumber: "1350-00065", nomenclature: "=HYPERLINK(\"bad\")", endingBalance: "0" }, { rowNumber: 100, inventoryNumber: "1350-00065", nomenclature: "ноутбук", endingBalance: "0" }] }],
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(workbook.getWorksheet("Сводка")!.getCell("B8").value, "b".repeat(64));
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.rowCount, 2);
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("A2").value, "Найдено совпадение");
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("G2").value, "'=HYPERLINK(\"bad\")");
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.rowCount, 3);
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.getCell("C2").value, "Да");
});

test("audit workbook preserves every 1C match and the origin of each record", async () => {
  const bytes = await exportInventorySourceAuditExcel({
    run: { batch_id: "batch-1", batch_version: 2, batch_sha256: "a".repeat(64), one_c_registry_sha256: "c".repeat(64), filename: "материалы 2026.xls", sha256: "b".repeat(64), run_at: new Date("2026-10-01T08:00:00Z"), counts: { total: 1, oneCOnly: 1, excelOnly: 0, both: 0, missing: 0, temporary: 0 } },
    rows: [{ itemId: "item-1", itemName: "Моноблок", siteNumber: "2413/0528", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: "1c", excel: [], oneC: [
      { externalId: "asset-1", code: null, inventoryNumber: "2413/0528", barcode: null, name: "Моноблок", status: "Снято с учёта", origins: ["selected_batch"], matchedBy: ["inventory_number"], matchedBarcodes: [] },
      { externalId: "asset-2", code: null, inventoryNumber: "2413/0528", barcode: null, name: "Моноблок", status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["inventory_number"], matchedBarcodes: [] },
    ] }],
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const details = workbook.getWorksheet("Все совпадения 1С")!;
  assert.equal(details.rowCount, 3);
  assert.equal(details.getCell("D2").value, "выбранная партия");
  assert.equal(details.getCell("D3").value, "текущий реестр");
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("S2").value, "выбранная партия");
});

test("audit workbook flags a slashless candidate and keeps the 1C review state separate", async () => {
  const bytes = await exportInventorySourceAuditExcel({
    run: { batch_id: "batch-1", batch_version: 3, algorithm_version: "3", counts: { total: 1, oneCOnly: 1, excelOnly: 0, both: 0, missing: 0, temporary: 0, possible: 1 } },
    rows: [{ itemId: "item-1", itemName: "Лабораторный стенд", siteNumber: "123/759", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: "1c", excel: [], oneC: [
      { externalId: "asset-1", code: null, inventoryNumber: "123759", barcode: null, name: "Стенд", status: "Не в учёте", reviewState: "conflict", origins: ["selected_batch"], matchedBy: ["number_without_slash"], matchedBarcodes: [] },
    ] }],
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("A2").value, "Возможное совпадение — проверьте номер");
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("T2").value, "conflict");
  assert.equal(workbook.getWorksheet("Все совпадения 1С")!.getCell("K2").value, "conflict");
});

test("audit workbook retains unmarked and literal range evidence with effective parser counts", async () => {
  const bytes = await exportInventorySourceAuditExcel({
    run: { batch_id: "batch", batch_version: 4, algorithm_version: "4", excel_accepted_count: 3, excel_skipped_count: 1, counts: { total: 1, excelOnly: 1, oneCOnly: 0, both: 0, missing: 0, temporary: 0, possible: 1 } },
    rows: [{ itemId: "tablet", itemName: "Планшет", siteNumber: "1350/14464", siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched", source: "excel", oneC: [], excel: [{ rowNumber: 3831, inventoryNumber: "1350/14464", nomenclature: "Планшет Samsung Galaxy Tab 1350/14464 от 26.03.20", endingBalance: "0", numberIsUnmarked: true, matchedBy: ["number_in_description"] }, { rowNumber: 3832, inventoryNumber: "206/486", sourceInventoryNumber: "206/486-487", nomenclature: "Плита №206/486-487 15 этаж", endingBalance: "0" }] }],
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.getCell("A2").value, "Возможное совпадение — проверьте номер");
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.getCell("J2").value, "Да — проверить");
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.getCell("I3").value, "206/486-487");
  assert.equal(workbook.getWorksheet("Сводка")!.getCell("B10").value, 3);
});

test("export uses the matched later bare reference rather than the first marked range in its source row", async () => {
  const item: AuditItem = { id: "tablet", name: "Планшет", inventoryNumber: "1350/14464", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const nomenclature = "Комплект №206/1832-1837; планшет Samsung Galaxy Tab 1350/14464 от 26.03.20";
  const references = extractExcelInventoryReferences(nomenclature);
  const excel: ExcelSourceRow[] = [{ rowNumber: 3831, nomenclature, ...references[0], inventoryReferences: references, endingBalance: "0" }];
  const audit = buildInventorySourceAudit([item], [], excel, []);
  assert.equal(audit.rows[0].excel[0].sourceInventoryNumber, "206/1832-1837");
  assert.equal(audit.rows[0].excel[0].matchedReference?.inventoryNumber, "1350/14464");
  assert.equal(audit.rows[0].excel[0].matchedReference?.numberIsUnmarked, true);
  assert.equal(audit.rows[0].excel[0].matchedReference?.sourceInventoryNumber, undefined);
  const bytes = await exportInventorySourceAuditExcel({
    run: { batch_id: "batch", batch_version: 5, algorithm_version: "5", counts: audit.counts },
    rows: audit.rows,
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const main = workbook.getWorksheet("Все ТМЦ")!;
  const details = workbook.getWorksheet("Все совпадения Excel")!;
  assert.equal(main.rowCount, 2);
  assert.equal(main.getCell("F2").value, "1350/14464");
  assert.equal(main.getCell("A2").value, "Возможное совпадение — проверьте номер");
  assert.equal(details.getCell("E2").value, "1350/14464");
  assert.equal(details.getCell("I2").value, "");
  assert.equal(details.getCell("J2").value, "Да — проверить");
  assert.equal(details.getCell("F2").value, nomenclature);
});

test("export preserves the matched later literal range and names the closest duplicate as primary in both sources", async () => {
  const item: AuditItem = { id: "plate", name: "Плита Gefest", inventoryNumber: "206/486-487", inventoryNumberKind: "official", oneCCode: null, sourceCodes: [], officialBarcodes: [], version: 1 };
  const nomenclature = "Плита Gefest №123/768; инв.№206/486-487 15 этаж";
  const references = extractExcelInventoryReferences(nomenclature);
  const excel: ExcelSourceRow[] = [
    { rowNumber: 2, inventoryNumber: "206/486", sourceInventoryNumber: "206/486-487", nomenclature: "Стол №206/486-487", endingBalance: "0" },
    { rowNumber: 500, nomenclature, ...references[0], inventoryReferences: references, endingBalance: "0" },
  ];
  const asset = (externalId: string, name: string) => ({ externalId, asset: { externalId, code: null, inventoryNumber: "206/486-487", barcode: null, name, status: "Снято с учёта" } as OneCFixedAsset });
  const audit = buildInventorySourceAudit([item], [asset("a-unrelated", "Стол"), asset("z-similar", "Плита Gefest")], excel, []);
  assert.equal(audit.rows[0].excel[0].inventoryNumber, "123/768");
  assert.equal(audit.rows[0].excel[0].matchedReference?.inventoryNumber, "206/486");
  assert.equal(audit.rows[0].excel[0].matchedReference?.sourceInventoryNumber, "206/486-487");
  const bytes = await exportInventorySourceAuditExcel({
    run: { batch_id: "batch", batch_version: 5, algorithm_version: "5", counts: audit.counts },
    rows: audit.rows,
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const main = workbook.getWorksheet("Все ТМЦ")!;
  const excelDetails = workbook.getWorksheet("Все совпадения Excel")!;
  const oneCDetails = workbook.getWorksheet("Все совпадения 1С")!;
  assert.equal(main.getCell("A2").value, "Найдено совпадение");
  assert.equal(main.getCell("F2").value, "206/486-487");
  assert.equal(main.getCell("H2").value, 500);
  assert.equal(main.getCell("J2").value, "z-similar");
  assert.equal(main.getCell("L2").value, "Плита Gefest");
  assert.equal(excelDetails.rowCount, 3);
  assert.equal(excelDetails.getCell("D2").value, 500);
  assert.equal(excelDetails.getCell("C2").value, "Да");
  assert.equal(excelDetails.getCell("C3").value, "Нет");
  assert.equal(excelDetails.getCell("I2").value, "206/486-487");
  assert.equal(excelDetails.getCell("J2").value, "Нет");
  assert.equal(oneCDetails.rowCount, 3);
  assert.equal(oneCDetails.getCell("C2").value, "z-similar");
  assert.equal(oneCDetails.getCell("C3").value, "a-unrelated");
  assert.equal(oneCDetails.getCell("L2").value, "Да");
  assert.equal(oneCDetails.getCell("L3").value, "Нет");
});

test("audit export labels search sources and separates saved counts from current records and quantities", async () => {
  const rows: AuditMatch[] = ["1c", "excel", "1c+excel"].map((source, index) => ({
    itemId: `item-${index}`, itemName: "Скамья", siteNumber: `050-000028${index}`,
    siteBarcodes: [], numberKind: "official", itemVersion: 1, result: "matched",
    source: source as AuditMatch["source"], oneC: [], excel: [],
  }));
  const bytes = await exportInventorySourceAuditExcel({
    run: {
      batch_id: "batch", batch_version: 12, sha256: "b".repeat(64), excel_accepted_count: 3500,
      counts: { total: 1988, oneCOnly: 736, excelOnly: 294, both: 67, missing: 891, temporary: 669, possible: 325 },
      inventory: { currentTotal: 2040, currentActive: 2000, currentQuantity: 2500, currentActiveQuantity: 2450, added: 52, removed: 0, changed: 3, linksChanged: true, stale: true },
    }, rows,
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.getWorksheet("Все ТМЦ")!;
  assert.deepEqual([sheet.getCell("B2").value, sheet.getCell("B3").value, sheet.getCell("B4").value], ["Только 1С", "Только Excel", "1С + Excel"]);
  const summary = workbook.getWorksheet("Сводка")!;
  const fields = new Map<string, unknown>();
  summary.eachRow((row) => fields.set(String(row.getCell(1).value), row.getCell(2).value));
  assert.equal(summary.getCell("B8").value, "b".repeat(64));
  assert.equal(summary.getCell("B10").value, 3500);
  assert.equal(fields.get("Всего"), 1988);
  assert.equal(fields.get("Только 1С"), 736);
  assert.equal(fields.get("Только Excel"), 294);
  assert.equal(fields.get("1С + Excel"), 67);
  assert.equal(fields.get("Не найдено"), 891);
  assert.equal(fields.get("Из них временные"), 669);
  assert.equal(fields.get("Из найденных: возможные"), 325);
  assert.equal(fields.get("Сейчас: всего записей ТМЦ"), 2040);
  assert.equal(fields.get("Сейчас: активных записей ТМЦ"), 2000);
  assert.equal(fields.get("Сейчас: всего единиц ТМЦ"), 2500);
  assert.equal(fields.get("Сейчас: активных единиц ТМЦ"), 2450);
  assert.equal(fields.get("После dry-run: добавлено записей"), 52);
  assert.equal(fields.get("После dry-run: удалено записей"), 0);
  assert.equal(fields.get("После dry-run: изменено записей"), 3);
  assert.equal(fields.get("После dry-run: изменились связи с 1С"), "Да");
  assert.equal(fields.get("Состояние сохранённой сверки"), "Устарела — повторите dry-run");
  assert.match(String(fields.get("Что означают категории")), /источники поиска/u);
  assert.match(String(fields.get("Что означают категории")), /учётную категорию/u);
  assert.match(String(fields.get("Записи и единицы ТМЦ")), /Количество/u);
  assert.equal(fields.has("oneCOnly"), false);
  assert.equal(fields.has("excelOnly"), false);
});

test("audit export partitions cards by source and keeps temporary and possible sheets as subsets", async () => {
  const item = (itemId: string, overrides: Partial<AuditMatch> = {}): AuditMatch => ({
    itemId, itemName: "Ноутбук", siteNumber: "2411/00388", siteBarcodes: [], numberKind: "official",
    itemVersion: 1, result: "matched", source: "1c", excel: [], oneC: [], ...overrides,
  });
  const oneC = { externalId: "asset-1", code: "00003254", inventoryNumber: "2411/00388", barcode: "001122", name: "Ноутбук Lenovo", status: "Принято к учёту", origins: ["current_registry"], matchedBy: ["number_spaces"], matchedBarcodes: [] } as AuditMatch["oneC"][number];
  const rows = [
    item("one-c", { oneC: [{ ...oneC, matchedBy: ["inventory_number"] }] }),
    item("excel", { source: "excel", excel: [{ rowNumber: 786, inventoryNumber: "2411/00388", nomenclature: "Ноутбук Lenovo", oneCCode: "00003254", endingBalance: "1", matchedBy: ["site_number"] }] }),
    item("both", { source: "1c+excel", oneC: [oneC], excel: [{ rowNumber: 787, inventoryNumber: "2411 / 00388", nomenclature: "Ноутбук Lenovo", endingBalance: "1", oneCCode: "00003254", matchedBy: ["number_spaces"] }] }),
    item("missing", { source: null, result: "missing" }),
    item("temporary", { source: null, result: "temporary", numberKind: "temporary", siteNumber: "TMP-123" }),
  ];
  const bytes = await exportInventorySourceAuditExcel({ run: { batch_id: "batch", batch_version: 7, counts: { total: 5, oneCOnly: 1, excelOnly: 1, both: 1, missing: 2, temporary: 1, possible: 1 } }, rows });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const ids = (name: string) => {
    const sheet = workbook.getWorksheet(name);
    assert.ok(sheet, `Missing category sheet ${name}`);
    return Array.from({ length: sheet.rowCount - 1 }, (_, index) => sheet.getCell(index + 2, 3).value);
  };
  assert.deepEqual(ids("Только 1С"), ["one-c"]);
  assert.deepEqual(ids("Только Excel"), ["excel"]);
  assert.deepEqual(ids("1С + Excel"), ["both"]);
  assert.deepEqual(ids("Не найдено"), ["missing", "temporary"]);
  assert.deepEqual(ids("Из них временные"), ["temporary"]);
  assert.deepEqual(ids("Из найденных возможные"), ["both"]);
  const partition = ["Только 1С", "Только Excel", "1С + Excel", "Не найдено"].flatMap(ids);
  assert.equal(partition.length, rows.length);
  assert.equal(new Set(partition).size, rows.length);
  assert.equal(workbook.getWorksheet("Все ТМЦ")!.rowCount, rows.length + 1);
  assert.equal(workbook.getWorksheet("1С + Excel")!.getCell("U2").value, "00003254");
  assert.equal(workbook.getWorksheet("1С + Excel")!.getCell("V2").value, "00003254");
  assert.equal(workbook.getWorksheet("1С + Excel")!.getCell("E2").value, "2411/00388");
  assert.equal(workbook.getWorksheet("1С + Excel")!.getCell("Q2").value, "001122");
  assert.equal(workbook.getWorksheet("1С + Excel")!.getCell("P2").value, "number_spaces");
  assert.equal(workbook.getWorksheet("Все совпадения 1С")!.getCell("E2").value, "00003254");
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.getCell("K2").value, "00003254");
  const summary = workbook.getWorksheet("Сводка")!;
  const fields = new Map<string, unknown>();
  summary.eachRow((row) => fields.set(String(row.getCell(1).value), row.getCell(2).value));
  assert.match(String(fields.get("Как читать количество")), /входят в «Не найдено»/u);
  assert.match(String(fields.get("Как читать количество")), /не прибавляются к общему количеству/u);
});

test("every category sheet preserves leading zeros and protects untrusted names, codes and evidence from formulas", async () => {
  const row: AuditMatch = {
    itemId: "item", itemName: " =HYPERLINK(\"bad\")", siteNumber: "00003254", siteBarcodes: [{ kind: "official", value: "001122" }], numberKind: "official", itemVersion: 1,
    result: "matched", source: "1c+excel", oneC: [{ externalId: "+bad", code: "@bad", inventoryNumber: "00003254", barcode: "001122", name: "-bad", status: "=bad", origins: ["current_registry"], matchedBy: ["number_spaces"], matchedBarcodes: [] }],
    excel: [{ rowNumber: 786, inventoryNumber: "00003254", nomenclature: "\uFEFF=bad", endingBalance: "=bad", oneCCode: "+bad", matchedBy: ["number_spaces"] }],
  };
  const bytes = await exportInventorySourceAuditExcel({ run: { batch_id: "=bad", batch_version: 7, counts: { total: 1, oneCOnly: 0, excelOnly: 0, both: 1, missing: 0, temporary: 0, possible: 1 } }, rows: [row] });
  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  for (const name of ["Все ТМЦ", "1С + Excel", "Из найденных возможные"]) {
    const sheet = workbook.getWorksheet(name);
    assert.ok(sheet);
    assert.equal(sheet.getCell("D2").value, "' =HYPERLINK(\"bad\")");
    assert.equal(sheet.getCell("E2").value, "00003254");
    assert.equal(sheet.getCell("G2").value, "'\uFEFF=bad");
    assert.equal(sheet.getCell("I2").value, "'=bad");
    assert.equal(sheet.getCell("J2").value, "'+bad");
    assert.equal(sheet.getCell("L2").value, "'-bad");
    assert.equal(sheet.getCell("U2").value, "'@bad");
    assert.equal(sheet.getCell("V2").value, "'+bad");
    sheet.eachRow((entry) => entry.eachCell((cell) => assert.notEqual(cell.type, 6, `${name}: formula ${cell.address}`)));
  }
  assert.equal(workbook.getWorksheet("Сводка")!.getCell("B2").value, "'=bad");
  assert.equal(workbook.getWorksheet("Все совпадения 1С")!.getCell("E2").value, "'@bad");
  assert.equal(workbook.getWorksheet("Все совпадения Excel")!.getCell("K2").value, "'+bad");
  for (const name of ["Только 1С", "Только Excel", "Не найдено", "Из них временные"]) assert.equal(workbook.getWorksheet(name)!.rowCount, 1);
});
