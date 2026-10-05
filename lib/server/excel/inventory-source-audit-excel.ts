import "server-only";

import { Workbook, type Worksheet } from "exceljs";
import { auditNeedsReview, type AuditMatch } from "@/lib/inventory-source-audit";

type AuditExport = { run: Record<string, unknown>; rows: AuditMatch[] };
const label = (result: AuditMatch["result"]) => result === "matched" ? "Найдено совпадение" : result === "temporary" ? "Временный номер — требуется проверка" : "Не найдено";
const source = (value: AuditMatch["source"]) => value === "1c+excel" ? "1С + Excel" : value === "1c" ? "Только 1С" : value === "excel" ? "Только Excel" : "";
const countLabels: Record<string, string> = {
  total: "Всего",
  oneCOnly: "Только 1С",
  excelOnly: "Только Excel",
  both: "1С + Excel",
  missing: "Не найдено",
  temporary: "Из них временные",
  possible: "Из найденных: возможные",
};
const inventoryLabels: Record<string, string> = {
  currentTotal: "Сейчас: всего записей ТМЦ",
  currentActive: "Сейчас: активных записей ТМЦ",
  currentQuantity: "Сейчас: всего единиц ТМЦ",
  currentActiveQuantity: "Сейчас: активных единиц ТМЦ",
  added: "После dry-run: добавлено записей",
  removed: "После dry-run: удалено записей",
  changed: "После dry-run: изменено записей",
};
function safeText(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /^[\s\uFEFF]*[=+@-]/u.test(text) ? `'${text}` : text;
}

function addInventoryRows(sheet: Worksheet, rows: AuditMatch[]): void {
  sheet.addRow(["Итог", "Источник", "ID ТМЦ", "Наименование сайта", "Номер сайта", "Инв. номер Excel", "Номенклатура Excel", "Строка Excel", "Конечный остаток Excel", "GUID 1С", "Инв. номер 1С", "Наименование 1С", "Статус 1С", "Ссылка на ТМЦ", "Штрихкоды сайта", "Найдено в Excel по", "Штрихкод 1С", "Найдено в 1С по", "Запись 1С из", "Статус проверки партии 1С", "Код 1С", "Код 1С из Excel"]);
  for (const row of rows) {
    const excel = row.excel[0], oneC = row.oneC[0];
    sheet.addRow([auditNeedsReview(row) ? "Возможное совпадение — проверьте номер" : label(row.result), source(row.source), safeText(row.itemId), safeText(row.itemName), safeText(row.siteNumber), safeText(excel?.matchedInventoryNumber ?? excel?.inventoryNumber), safeText(excel?.nomenclature), excel?.rowNumber ?? "", safeText(excel?.endingBalance), safeText(oneC?.externalId), safeText(oneC?.inventoryNumber), safeText(oneC?.name), safeText(oneC?.status), `/items/${row.itemId}`, safeText(row.siteBarcodes?.map((barcode) => `${barcode.kind}: ${barcode.value}`).join("; ")), safeText(excel?.matchedBy?.join(", ")), safeText(oneC?.barcode), safeText(oneC?.matchedBy?.join(", ")), safeText(oneC?.origins?.map((origin) => origin === "selected_batch" ? "выбранная партия" : "текущий реестр").join(", ")), safeText(oneC?.reviewState), safeText(oneC?.code), safeText(excel?.oneCCode)]);
  }
  sheet.columns.forEach((column) => { column.width = 24; });
  sheet.getColumn(4).width = 42;
  sheet.getColumn(7).width = 60;
}

export async function exportInventorySourceAuditExcel(data: AuditExport): Promise<Uint8Array> {
  const workbook = new Workbook();
  workbook.creator = "Yessenov University Inventory";
  const summary = workbook.addWorksheet("Сводка");
  const counts = data.run.counts as Record<string, number>;
  summary.addRows([
    ["Параметр", "Значение"],
    ["Партия 1С", safeText(data.run.batch_id)],
    ["Версия партии 1С", Number(data.run.batch_version)],
    ["Версия поиска", safeText(data.run.algorithm_version ?? "прежняя — повторите dry-run")],
    ["SHA-256 партии 1С", safeText(data.run.batch_sha256)],
    ["SHA-256 текущего реестра 1С", safeText(data.run.one_c_registry_sha256)],
    ["Файл Excel", safeText(data.run.filename)],
    ["SHA-256 Excel", safeText(data.run.sha256)],
    ["Время dry-run", data.run.run_at instanceof Date ? data.run.run_at.toISOString() : safeText(data.run.run_at)],
    ["Строк Excel с номерами при dry-run", data.run.excel_accepted_count ?? ""],
    ["Строк Excel без номера при dry-run", data.run.excel_skipped_count ?? ""],
    ...Object.entries(countLabels).map(([key, text]) => [text, counts[key] ?? 0]),
    ["Что означают категории", "Только 1С — совпадение только в 1С; Только Excel — только в Excel; 1С + Excel — в обоих источниках. Это источники поиска, они не определяют учётную категорию ТМЦ."],
    ["Записи и единицы ТМЦ", "Сохранённая сверка считает записи на момент dry-run. Одна запись ТМЦ может содержать несколько единиц в поле «Количество». Текущие показатели сайта приведены отдельно."],
    ["Как читать количество", "«Только 1С» + «Только Excel» + «1С + Excel» + «Не найдено» = «Всего». Временные входят в «Не найдено», возможные — в найденные; эти два показателя не прибавляются к общему количеству. Каждая карточка встречается один раз в четырёх основных группах. Листы содержат сохранённые результаты dry-run."],
  ]);
  summary.getRow(summary.rowCount - 2).height = 60;
  summary.getRow(summary.rowCount - 1).height = 45;
  summary.getRow(summary.rowCount).height = 75;
  if (data.run.inventory && typeof data.run.inventory === "object") {
    const inventory = data.run.inventory as Record<string, unknown>;
    for (const [key, text] of Object.entries(inventoryLabels)) {
      if (typeof inventory[key] === "number" && Number.isFinite(inventory[key])) summary.addRow([text, inventory[key]]);
    }
    if (typeof inventory.linksChanged === "boolean") summary.addRow(["После dry-run: изменились связи с 1С", inventory.linksChanged ? "Да" : "Нет"]);
    if (typeof inventory.stale === "boolean") summary.addRow(["Состояние сохранённой сверки", inventory.stale ? "Устарела — повторите dry-run" : "Соответствует текущим записям ТМЦ"]);
  }
  summary.getColumn(1).width = 60; summary.getColumn(2).width = 80;
  summary.getColumn(2).alignment = { vertical: "top", wrapText: true };
  const sheet = workbook.addWorksheet("Все ТМЦ", { views: [{ state: "frozen", ySplit: 1 }] });
  addInventoryRows(sheet, data.rows);
  const groups: { name: string; contains: (row: AuditMatch) => boolean }[] = [
    { name: "Только 1С", contains: (row) => row.result === "matched" && row.source === "1c" },
    { name: "Только Excel", contains: (row) => row.result === "matched" && row.source === "excel" },
    { name: "1С + Excel", contains: (row) => row.result === "matched" && row.source === "1c+excel" },
    { name: "Не найдено", contains: (row) => row.result !== "matched" },
    { name: "Из них временные", contains: (row) => row.result === "temporary" },
    // Excel forbids ':' in worksheet names; the summary retains the requested label.
    { name: "Из найденных возможные", contains: (row) => row.result === "matched" && auditNeedsReview(row) },
  ];
  const groupSheets = groups.map(({ name, contains }) => {
    const group = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    addInventoryRows(group, data.rows.filter(contains));
    return group;
  });
  const details = workbook.addWorksheet("Все совпадения Excel", { views: [{ state: "frozen", ySplit: 1 }] });
  details.addRow(["ID ТМЦ", "Наименование сайта", "Основная строка", "Строка Excel", "Инв. номер Excel", "Номенклатура Excel", "Конечный остаток Excel", "Найдено по", "Исходная запись диапазона", "Номер без пометки инв.", "Код 1С из Excel"]);
  for (const row of data.rows) row.excel.forEach((excel, index) => details.addRow([safeText(row.itemId), safeText(row.itemName), index === 0 ? "Да" : "Нет", excel.rowNumber, safeText(excel.matchedInventoryNumber ?? excel.inventoryNumber), safeText(excel.nomenclature), safeText(excel.endingBalance), safeText(excel.matchedBy?.join(", ")), safeText((excel.matchedReference ?? excel).sourceInventoryNumber), (excel.matchedReference ?? excel).numberIsUnmarked ? "Да — проверить" : "Нет", safeText(excel.oneCCode)]));
  const oneCDetails = workbook.addWorksheet("Все совпадения 1С", { views: [{ state: "frozen", ySplit: 1 }] });
  oneCDetails.addRow(["ID ТМЦ", "Номер сайта", "GUID 1С", "Источник записи", "Код 1С", "Инв. номер 1С", "Штрихкод 1С", "Наименование 1С", "Статус 1С", "Найдено по", "Статус проверки партии 1С", "Основной вариант"]);
  for (const row of data.rows) for (const entry of row.oneC) oneCDetails.addRow([safeText(row.itemId), safeText(row.siteNumber), safeText(entry.externalId), safeText(entry.origins?.map((origin) => origin === "selected_batch" ? "выбранная партия" : "текущий реестр").join(", ")), safeText(entry.code), safeText(entry.inventoryNumber), safeText(entry.barcode), safeText(entry.name), safeText(entry.status), safeText(entry.matchedBy?.join(", ")), safeText(entry.reviewState), entry === row.oneC[0] ? "Да" : "Нет"]);
  details.columns.forEach((column) => { column.width = 30; }); details.getColumn(6).width = 65; oneCDetails.columns.forEach((column) => { column.width = 30; }); oneCDetails.getColumn(8).width = 60;
  for (const worksheet of [summary, sheet, ...groupSheets, details, oneCDetails]) {
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002060" } };
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: worksheet.getRow(1).cellCount } };
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
