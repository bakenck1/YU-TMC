import "server-only";

import { Workbook } from "exceljs";
import type { AuditMatch } from "@/lib/inventory-source-audit";

type AuditExport = { run: Record<string, unknown>; rows: AuditMatch[] };
const label = (result: AuditMatch["result"]) => result === "matched" ? "Найдено совпадение" : result === "temporary" ? "Временный номер — требуется проверка" : "Не найдено";
const source = (value: AuditMatch["source"]) => value === "1c+excel" ? "1С + Excel" : value === "1c" ? "1С" : value === "excel" ? "Excel" : "";
function safeText(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /^[\s\uFEFF]*[=+@-]/u.test(text) ? `'${text}` : text;
}

export async function exportInventorySourceAuditExcel(data: AuditExport): Promise<Uint8Array> {
  const workbook = new Workbook();
  workbook.creator = "Yessenov University Inventory";
  const summary = workbook.addWorksheet("Сводка");
  summary.addRows([
    ["Параметр", "Значение"],
    ["Партия 1С", safeText(data.run.batch_id)],
    ["Версия партии 1С", Number(data.run.batch_version)],
    ["SHA-256 партии 1С", safeText(data.run.batch_sha256)],
    ["SHA-256 текущего реестра 1С", safeText(data.run.one_c_registry_sha256)],
    ["Файл Excel", safeText(data.run.filename)],
    ["SHA-256 Excel", safeText(data.run.sha256)],
    ["Время dry-run", data.run.run_at instanceof Date ? data.run.run_at.toISOString() : safeText(data.run.run_at)],
    ...Object.entries(data.run.counts as Record<string, number>).map(([key, value]) => [key, value]),
  ]);
  summary.getColumn(1).width = 32; summary.getColumn(2).width = 80;
  const sheet = workbook.addWorksheet("Все ТМЦ", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(["Итог", "Источник", "ID ТМЦ", "Наименование сайта", "Номер сайта", "Инв. номер Excel", "Номенклатура Excel", "Строка Excel", "Конечный остаток Excel", "GUID 1С", "Инв. номер 1С", "Наименование 1С", "Статус 1С", "Ссылка на ТМЦ", "Штрихкоды сайта", "Найдено в Excel по", "Штрихкод 1С", "Найдено в 1С по", "Запись 1С из"]);
  for (const row of data.rows) {
    const excel = row.excel[0], oneC = row.oneC[0];
    sheet.addRow([label(row.result), source(row.source), safeText(row.itemId), safeText(row.itemName), safeText(row.siteNumber), safeText(excel?.inventoryNumber), safeText(excel?.nomenclature), excel?.rowNumber ?? "", safeText(excel?.endingBalance), safeText(oneC?.externalId), safeText(oneC?.inventoryNumber), safeText(oneC?.name), safeText(oneC?.status), `/items/${row.itemId}`, safeText(row.siteBarcodes?.map((barcode) => `${barcode.kind}: ${barcode.value}`).join("; ")), safeText(excel?.matchedBy?.join(", ")), safeText(oneC?.barcode), safeText(oneC?.matchedBy?.join(", ")), safeText(oneC?.origins?.map((origin) => origin === "selected_batch" ? "выбранная партия" : "текущий реестр").join(", "))]);
  }
  const details = workbook.addWorksheet("Все совпадения Excel", { views: [{ state: "frozen", ySplit: 1 }] });
  details.addRow(["ID ТМЦ", "Наименование сайта", "Основная строка", "Строка Excel", "Инв. номер Excel", "Номенклатура Excel", "Конечный остаток Excel"]);
  for (const row of data.rows) row.excel.forEach((excel, index) => details.addRow([safeText(row.itemId), safeText(row.itemName), index === 0 ? "Да" : "Нет", excel.rowNumber, safeText(excel.inventoryNumber), safeText(excel.nomenclature), safeText(excel.endingBalance)]));
  const oneCDetails = workbook.addWorksheet("Все совпадения 1С", { views: [{ state: "frozen", ySplit: 1 }] });
  oneCDetails.addRow(["ID ТМЦ", "Номер сайта", "GUID 1С", "Источник записи", "Код 1С", "Инв. номер 1С", "Штрихкод 1С", "Наименование 1С", "Статус 1С", "Найдено по"]);
  for (const row of data.rows) for (const entry of row.oneC) oneCDetails.addRow([safeText(row.itemId), safeText(row.siteNumber), safeText(entry.externalId), safeText(entry.origins?.map((origin) => origin === "selected_batch" ? "выбранная партия" : "текущий реестр").join(", ")), safeText(entry.code), safeText(entry.inventoryNumber), safeText(entry.barcode), safeText(entry.name), safeText(entry.status), safeText(entry.matchedBy?.join(", "))]);
  sheet.columns.forEach((column) => { column.width = 24; });
  sheet.getColumn(4).width = 42; sheet.getColumn(7).width = 60; details.columns.forEach((column) => { column.width = 30; }); details.getColumn(6).width = 65; oneCDetails.columns.forEach((column) => { column.width = 30; }); oneCDetails.getColumn(8).width = 60;
  for (const worksheet of [summary, sheet, details, oneCDetails]) {
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002060" } };
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: worksheet.getRow(1).cellCount } };
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
