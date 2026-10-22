import "server-only";

import { Workbook, type Worksheet } from "exceljs";
import type { AuditMatch } from "@/lib/inventory-source-audit";
import { classifyOneCAudit } from "@/lib/one-c-analytics";
import type { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";

type Snapshot = Awaited<ReturnType<typeof getOneCAnalyticsSnapshot>>;
const safeText = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /^[\s\uFEFF]*[=+@-]/u.test(text) ? `'${text}` : text;
};
const joined = (values: (string | null | undefined)[]) => safeText([...new Set(values.filter(Boolean))].join("\n"));

/** Five full lists, computed afresh; no saved dry-run or pagination limits. */
export async function exportOneCAnalyticsExcel(data: Snapshot): Promise<Uint8Array> {
  const workbook = new Workbook();
  workbook.creator = "YU Inventory";
  workbook.created = new Date(data.analytics.calculatedAt);
  const hasAssets = data.analytics.assets.receivedAt !== null;
  const hasMaterials = data.materials.batchId !== null;
  const hasSources = hasAssets || hasMaterials;
  const complete = hasAssets && hasMaterials;
  const presence = classifyOneCAudit(data.rows);
  const found = data.rows.filter(row => {
    const confirmed = presence.get(row.itemId)!;
    return confirmed.fixedAssets || confirmed.materials;
  });
  const candidates = data.rows.filter(row => row.oneC.length || row.excel.length);
  const temporary = data.rows.filter(row => row.numberKind === "temporary");
  const missing = hasSources ? data.rows.filter(row => !row.oneC.length && !row.excel.length) : [];
  const inventory = new Map(data.inventory.map(item => [item.id, item]));
  const assetById = new Map(data.assets.map(row => [row.externalId, row.asset]));
  const time = new Date(data.analytics.calculatedAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
  const summary = `Всего в 1С: ${complete ? data.analytics.assets.total + data.materials.materialCount : "нет полного итога"} активных позиций · ОС: ${hasAssets ? data.analytics.assets.total : "нет данных"} · МП: ${hasMaterials ? data.materials.materialCount : "нет данных"} · Наша база: ${data.analytics.inventory.total} активных карточек, ${data.analytics.inventory.quantity} единиц`;
  const availability = !hasSources ? "Нет данных ОС и МП для сверки. Карточки не объявлены ненайденными."
    : !complete ? `Сверка только по ${hasAssets ? "ОС" : "МП"}; ${hasAssets ? "МП" : "ОС"}: нет данных. Ненайденные — в доступном разделе.`
      : "Сверка по ОС и МП. Каждая карточка учитывается один раз; временные номера могут входить в найденные и ненайденные.";

  function sheet(name: string, title: string, detail: string, headers: string[], widths: number[]) {
    const result = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 5 }], properties: { defaultRowHeight: 30 } });
    result.columns = widths.map(width => ({ width }));
    for (const [index, value] of [title, detail, summary, `${time} (Казахстан). ${availability}`].entries()) {
      result.mergeCells(index + 1, 1, index + 1, headers.length);
      result.getCell(index + 1, 1).value = value;
      result.getRow(index + 1).height = index === 0 ? 34 : 32;
    }
    result.getCell("A1").font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF002060" } };
    result.addRow(headers);
    result.getRow(5).height = 42;
    result.getRow(5).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    result.getRow(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002060" } };
    result.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: headers.length } };
    return result;
  }
  const assets = sheet("ОС", "Основные средства на учёте", hasAssets ? `${data.assets.length} активных позиций. Полный список ОС на учёте.` : "Нет данных ОС.",
    ["№", "Код 1С", "Наименование", "Инвентарный номер", "Штрихкод", "Количество", "Статус", "Ответственный", "Расположение", "GUID 1С", "Первоначальная стоимость, KZT", "Остаточная стоимость, KZT", "Категория 1С"],
    [8, 20, 55, 25, 25, 15, 25, 32, 30, 38, 26, 26, 30]);
  data.assets.forEach(({ externalId, asset }, index) => assets.addRow([
    index + 1, safeText(asset.code), safeText(asset.name), safeText(asset.inventoryNumber), safeText(asset.barcode), asset.quantity,
    safeText(asset.status), safeText(asset.responsibleName), safeText(asset.location), safeText(externalId),
    asset.initialCost ?? null, asset.residualCost, safeText(asset.category),
  ]));
  assets.getColumn(11).numFmt = '#,##0.00';
  assets.getColumn(12).numFmt = '#,##0.00';

  const materials = sheet("МП", "Материальный предмет с наличием", hasMaterials ? `${data.materials.materialCount} активных позиций · ${data.materialRecords.length} строк остатков с наличием. Один код может иметь несколько строк по складам и ответственным.` : "Нет данных МП.",
    ["№", "Код 1С", "Наименование", "Инвентарный номер", "Штрихкод", "Остаток", "Единица", "Счёт", "Склад", "Ответственный", "Код ответственного", "Учётная цена, KZT", "GUID 1С"],
    [8, 20, 55, 25, 25, 16, 14, 16, 30, 32, 22, 22, 38]);
  data.materialRecords.forEach(({ material }, index) => materials.addRow([
    index + 1, safeText(material.code), safeText(material.name), safeText(material.inventoryNumber), safeText(material.barcode),
    Number(material.quantity), safeText(material.unit), safeText(material.accountCode), safeText(material.warehouseName ?? material.warehouseCode),
    safeText(material.responsibleName), safeText(material.responsibleCode), material.unitPrice === null ? null : Number(material.unitPrice), safeText(material.externalId),
  ]));
  materials.getColumn(12).numFmt = '#,##0.00';

  function inventorySheet(name: string, title: string, rows: AuditMatch[], note: string) {
    const count = `${rows.length} карточек · ${rows.reduce((sum, row) => sum + (inventory.get(row.itemId)?.quantity ?? 0), 0)} единиц`;
    const result = sheet(name, title, `${hasSources || name === "Временные" ? count : "Сверка недоступна"}. ${note}`,
      ["№", "ID карточки", "Наименование в нашей базе", "Номер в нашей базе", "Тип номера", "Количество", "Результат сверки", "Раздел 1С", "Код в нашей базе", "Коды ОС", "Наименования ОС", "Номера ОС", "Коды МП", "Наименования МП", "Номера МП", "Штрихкоды нашей базы", "Цена в нашей базе, KZT", "Ответственный в нашей базе", "Ответственные ОС", "Ответственные МП"],
      [8, 38, 55, 25, 20, 16, 30, 20, 20, 24, 55, 25, 24, 55, 25, 30, 24, 36, 36, 36]);
    rows.forEach((row, index) => {
      const candidates = row.oneC.length || row.excel.length;
      const confirmed = presence.get(row.itemId)!;
      const status = !hasSources ? "Нет данных для сверки" : !candidates ? "Не найдено" : confirmed.category === "possible" ? "Совпадение не подтверждено" : "Найдено";
      const registry = confirmed.category === "both" ? "ОС + МП" : confirmed.fixedAssets ? `ОС${row.excel.length ? "; МП не подтверждено" : ""}` : confirmed.materials ? `МП${row.oneC.length ? "; ОС не подтверждено" : ""}`
        : candidates ? `${row.oneC.length && row.excel.length ? "ОС + МП" : row.oneC.length ? "ОС" : "МП"} (не подтверждено)` : "";
      result.addRow([
        index + 1, safeText(row.itemId), safeText(row.itemName), safeText(row.siteNumber), row.numberKind === "temporary" ? "Временный" : "Постоянный",
        inventory.get(row.itemId)?.quantity ?? 0, status, registry,
        safeText(inventory.get(row.itemId)?.oneCCode), joined(row.oneC.map(entry => entry.code)), joined(row.oneC.map(entry => entry.name)), joined(row.oneC.map(entry => entry.inventoryNumber)),
        joined(row.excel.map(entry => entry.oneCCode)), joined(row.excel.map(entry => entry.nomenclature)), joined(row.excel.map(entry => entry.matchedInventoryNumber ?? entry.inventoryNumber)),
        joined(row.siteBarcodes.map(barcode => barcode.value)),
        inventory.get(row.itemId)?.unitPrice == null ? null : Number(inventory.get(row.itemId)!.unitPrice),
        safeText(inventory.get(row.itemId)?.responsibleName),
        joined(row.oneC.map(entry => assetById.get(entry.externalId)?.responsibleName)),
        joined(row.excel.map(entry => entry.responsibleName)),
      ]);
    });
    result.getColumn(17).numFmt = '#,##0.00';
    return result;
  }
  inventorySheet("Совпадения 1С", "Сверка с 1С", hasSources ? candidates : [], `Найдено: ${found.length}. Совпадение не подтверждено: ${data.analytics.reconciliation.possible}. ОС: ${data.analytics.reconciliation.fixedAssets} · МП: ${data.analytics.reconciliation.materials + data.analytics.reconciliation.both}. Статус указан для каждой карточки.`);
  inventorySheet("Временные", "Временные номера в нашей базе", temporary, "Все карточки с временным номером, независимо от результата сверки.");
  inventorySheet("Не найдено в 1С", "Есть в нашей базе — не найдено в 1С", missing, "Карточки без совпадений. Возможные совпадения сюда не включены.");
  for (const worksheet of workbook.worksheets) finishSheet(worksheet);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function finishSheet(sheet: Worksheet) {
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "middle", wrapText: true };
    if (rowNumber !== 1 && rowNumber !== 5) row.font = { name: "Calibri", size: 11, color: { argb: "FF334155" } };
    if (rowNumber > 5) {
      let lines = 1;
      row.eachCell((cell, column) => {
        const text = String(cell.value ?? "");
        lines = Math.max(lines, text.split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / ((sheet.getColumn(column).width ?? 20) - 2))), 0));
        if (typeof cell.value === "number" && !cell.numFmt) cell.numFmt = '#,##0.###';
      });
      row.height = Math.min(409, Math.max(30, lines * 16 + 8));
      if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    }
  });
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, sheet.rowCount), column: sheet.columnCount } };
}
