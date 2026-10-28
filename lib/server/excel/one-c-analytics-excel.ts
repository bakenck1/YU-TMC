import "server-only";

import { Workbook, type Worksheet } from "exceljs";
import type { AuditMatch } from "@/lib/inventory-source-audit";
import { classifyOneCAudit, oneCAuditDisplayCategory } from "@/lib/one-c-analytics";
import { isTemporaryOneCCard } from "@/lib/one-c-material-code";
import { getOneCMatchedCards } from "@/lib/one-c-matched-cards";
import type { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";

type FullSnapshot = Awaited<ReturnType<typeof getOneCAnalyticsSnapshot>>;
type Snapshot = Omit<FullSnapshot, "registryAssets"> & { registryAssets?: FullSnapshot["registryAssets"] };
const safeText = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /^[\s\uFEFF]*[=+@-]/u.test(text) ? `'${text}` : text;
};
const joined = (values: (string | null | undefined)[]) => safeText([...new Set(values.filter(Boolean))].join("\n"));
const amountCell = (value: unknown): number | null => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

/** Full lists and both directions of reconciliation from one current snapshot. */
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
  const temporary = data.rows.filter(row => isTemporaryOneCCard(row.numberKind, row.siteNumber));
  const missing = hasSources ? data.rows.filter(row => !row.oneC.length && !row.excel.length && !isTemporaryOneCCard(row.numberKind, row.siteNumber)) : [];
  const inventory = new Map(data.inventory.map(item => [item.id, item]));
  const assetById = new Map((data.registryAssets ?? data.assets).map(row => [row.externalId, row.asset]));
  const materialByKey = new Map(data.materialRecords.map(row => [row.key, row.material]));
  const matchedMaterials = getOneCMatchedCards(data).filter(card => card.group === "materials");
  const time = new Date(data.analytics.calculatedAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
  const summary = `Активные позиции 1С: ${complete ? data.analytics.assets.total + data.materials.materialCount : "нет полного итога"} = ОС ${hasAssets ? data.analytics.assets.total : "нет данных"} + МП ${hasMaterials ? data.materials.materialCount : "нет данных"} · Наша база: ${data.analytics.inventory.total} карточек (${data.analytics.inventory.active} активных), ${data.analytics.inventory.quantity} единиц`;
  const availability = !hasSources ? "Нет данных ОС и МП для сверки. Карточки не объявлены ненайденными."
    : !complete ? `Сверка только по ${hasAssets ? "ОС" : "МП"}; ${hasAssets ? "МП" : "ОС"}: нет данных. Ненайденные — в доступном разделе.`
      : "Для сверки взяты все статусы ОС и все карточки нашей базы, кроме архива. Временные есть на отдельном листе и могут также быть в «Совпадениях 1С».";

  function sheet(name: string, title: string, detail: string, headers: string[], widths: number[]) {
    const result = workbook.addWorksheet(name, { views: [{ state: "frozen", xSplit: 3, ySplit: 5 }], properties: { defaultRowHeight: 30 } });
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
  const assets = sheet("ОС", "Основные средства на учёте", hasAssets ? `${data.assets.length} записей со статусом «Принято к учёту». Остальные статусы ОС участвуют в сверке карточек на третьем листе.` : "Нет данных ОС.",
    ["№", "Код 1С", "Наименование", "Инвентарный номер", "Штрихкод", "Количество", "Статус", "Ответственный", "Расположение", "GUID 1С", "Первоначальная стоимость, KZT", "Остаточная стоимость, KZT", "Категория 1С"],
    [8, 20, 55, 25, 25, 15, 25, 32, 30, 38, 26, 26, 30]);
  data.assets.forEach(({ externalId, asset }, index) => assets.addRow([
    index + 1, safeText(asset.code), safeText(asset.name), safeText(asset.inventoryNumber), safeText(asset.barcode), asset.quantity,
    safeText(asset.status), safeText(asset.responsibleName), safeText(asset.location), safeText(externalId),
    amountCell(asset.initialCost), amountCell(asset.residualCost), safeText(asset.category),
  ]));
  assets.getColumn(11).numFmt = '#,##0.00';
  assets.getColumn(12).numFmt = '#,##0.00';

  const materials = sheet("МП", "Материальные предметы", `${hasMaterials ? `${data.materials.materialCount} кодов МП с положительным остатком · ${data.materialRecords.length} строк остатков.` : "Нет исходных остатков МП."} Ниже: ${matchedMaterials.length} найденных карточек нашей базы из группы МП.`,
    ["№", "Код 1С", "Наименование", "Инвентарный номер", "Штрихкод", "Остаток", "Единица", "Счёт", "Склад", "Ответственный", "Код ответственного", "Учётная цена, KZT", "GUID 1С", "Тип строки", "ID карточки", "Цена в нашей базе, KZT", "Статус цены", "Источник совпадения"],
    [8, 20, 55, 25, 25, 16, 14, 16, 30, 32, 22, 22, 38, 26, 38, 25, 25, 24]);
  data.materialRecords.forEach(({ material }, index) => materials.addRow([
    index + 1, safeText(material.code), safeText(material.name), safeText(material.inventoryNumber), safeText(material.barcode),
    Number(material.quantity), safeText(material.unit), safeText(material.accountCode), safeText(material.warehouseName ?? material.warehouseCode),
    safeText(material.responsibleName), safeText(material.responsibleCode), amountCell(material.unitPrice), safeText(material.externalId), "Остаток 1С", "", null, "", "МП",
  ]));
  materials.getColumn(12).numFmt = '#,##0.00';
  materials.getColumn(16).numFmt = '#,##0.00';
  const matchedMaterialsStart = materials.rowCount + 1;
  const priceStatus = { ready: "Готова к обновлению", unchanged: "Совпадает", missing: "В 1С нет цены", invalid: "Некорректная цена", ambiguous: "Цены различаются", unconfirmed: "Нет подтверждённой цены" };
  matchedMaterials.forEach(card => materials.addRow([
    0, safeText(card.oneCCode ?? card.sourceCodes.join("\n")), safeText(card.name), safeText(card.inventoryNumber), safeText(card.barcode),
    card.quantity, "шт", "", "", safeText(card.responsibleName), "", amountCell(card.oneCUnitPrice), "", "Карточка нашей базы", safeText(card.id),
    amountCell(card.currentUnitPrice), priceStatus[card.priceStatus], safeText(card.source),
  ]));

  const sourcePrices = (values: (string | number | null | undefined)[]) => {
    const amounts = values.filter(value => value !== null && value !== undefined && value !== "")
      .map(value => Number(value)).filter(Number.isFinite);
    const distinct = [...new Set(amounts)];
    return distinct.length === 0 ? null : distinct.length === 1 ? distinct[0] : distinct.join("\n");
  };

  function inventorySheet(name: string, title: string, rows: AuditMatch[], note: string) {
    // Keep the saved code visible on the temporary sheet even without any source match.
    const columns = <T,>(values: T[]): T[] => name === "Временные"
      ? [values[0], values[8], ...values.slice(1, 8), ...values.slice(9)] : values;
    const count = `${rows.length} карточек · ${rows.reduce((sum, row) => sum + (inventory.get(row.itemId)?.quantity ?? 0), 0)} единиц`;
    const result = sheet(name, title, `${hasSources || name === "Временные" ? count : "Сверка недоступна"}. ${note}`,
      columns(["№", "ID карточки", "Наименование в нашей базе", "Номер в нашей базе", "Тип номера", "Количество", "Результат сверки", "Раздел 1С", "Код 1С в нашей базе", "Коды ОС", "Наименования ОС", "Номера ОС", "Коды МП", "Наименования МП", "Номера МП", "Штрихкоды нашей базы", "Цена в нашей базе, KZT", "Ответственный в нашей базе", "Ответственные ОС", "Ответственные МП", "Статусы ОС в 1С", "Первоначальная стоимость ОС, KZT", "Остаточная стоимость ОС, KZT", "Цены строк МП, KZT"]),
      columns([8, 38, 55, 25, 20, 16, 26, 20, 20, 24, 55, 25, 24, 55, 25, 30, 25, 36, 36, 36, 30, 27, 27, 24]));
    rows.forEach((row, index) => {
      const candidates = row.oneC.length || row.excel.length;
      const confirmed = presence.get(row.itemId)!;
      const status = !hasSources ? "Нет данных для сверки" : !candidates ? "Не найдено" : confirmed.category === "possible" ? "Нужно сверить номер" : "Найдено";
      const displayCategory = oneCAuditDisplayCategory(row, confirmed);
      const registry = confirmed.category === "both" || displayCategory === "materials" && confirmed.fixedAssets ? "МП" : confirmed.fixedAssets ? `ОС${row.excel.length ? "; МП: проверить номер" : ""}` : confirmed.materials ? `МП${row.oneC.length ? "; ОС: проверить номер" : ""}`
        : candidates ? `${row.oneC.length && row.excel.length ? "ОС + МП" : row.oneC.length ? "ОС" : "МП"} (проверить номер)` : "";
      result.addRow(columns<unknown>([
        index + 1, safeText(row.itemId), safeText(row.itemName), safeText(row.siteNumber), isTemporaryOneCCard(row.numberKind, row.siteNumber) ? "Временный" : "Постоянный",
        inventory.get(row.itemId)?.quantity ?? 0, status, registry,
        safeText(inventory.get(row.itemId)?.oneCCode ?? row.siteOneCCode), joined(row.oneC.map(entry => entry.code)), joined(row.oneC.map(entry => entry.name)), joined(row.oneC.map(entry => entry.inventoryNumber)),
        joined(row.excel.map(entry => entry.oneCCode)), joined(row.excel.map(entry => entry.nomenclature)), joined(row.excel.map(entry => entry.matchedInventoryNumber ?? entry.inventoryNumber)),
        joined(row.siteBarcodes.map(barcode => barcode.value)),
        inventory.get(row.itemId)?.unitPrice == null ? null : Number(inventory.get(row.itemId)!.unitPrice),
        safeText(inventory.get(row.itemId)?.responsibleName),
        joined(row.oneC.map(entry => assetById.get(entry.externalId)?.responsibleName)),
        joined(row.excel.map(entry => entry.responsibleName)),
        joined(row.oneC.map(entry => entry.status)),
        sourcePrices(confirmed.fixedAssets ? row.oneC.map(entry => assetById.get(entry.externalId)?.initialCost) : []),
        sourcePrices(confirmed.fixedAssets ? row.oneC.map(entry => assetById.get(entry.externalId)?.residualCost) : []),
        sourcePrices(confirmed.materials ? row.excel.map(entry => entry.sourceKey ? materialByKey.get(entry.sourceKey)?.unitPrice : null) : []),
      ]));
    });
    result.getColumn(17).numFmt = '#,##0.00';
    for (const column of [22, 23, 24]) result.getColumn(column).numFmt = '#,##0.00';
    return result;
  }
  inventorySheet("Совпадения 1С", "Сверка с 1С", hasSources ? candidates : [], `Найдено: ${found.length}. Нужно сверить номер: ${data.analytics.reconciliation.possible}. ОС: ${data.analytics.reconciliation.fixedAssets} · МП: ${data.analytics.reconciliation.materials + data.analytics.reconciliation.both}. Цены ОС и МП показаны отдельно от цены нашей базы.`);
  inventorySheet("Временные", "Временные номера в нашей базе", temporary, "Все карточки с временным номером, включая найденные в 1С. Список может пересекаться с листом «Совпадения 1С».");
  inventorySheet("Не найдено в 1С", "Есть в нашей базе — не найдено в 1С", missing, "Постоянные номера без совпадений. Временные номера находятся на отдельном листе.");
  // A weak candidate also prevents calling a source record wholly absent.
  const seenAssets = new Set(data.rows.flatMap(row => row.oneC.map(entry => entry.externalId)));
  const seenMaterials = new Set(data.rows.flatMap(row => row.excel.flatMap(entry => entry.sourceKey ? [entry.sourceKey] : [])));
  const absentAssets = hasAssets ? data.assets.filter(row => !seenAssets.has(row.externalId)) : [];
  const absentMaterials = hasMaterials ? data.materialRecords.filter(row => !seenMaterials.has(row.key)) : [];
  const toAdd = sheet("Добавить в базу", "Есть в 1С — нет в нашей базе", `${absentAssets.length} ОС · ${absentMaterials.length} строк остатков МП. Без кандидата среди неархивных карточек. Проверьте перед добавлением; строки МП могут повторяться по складам и ответственным.`,
    ["Ответственный", "Цена за единицу, KZT", "Наименование", "Код 1С", "Инвентарный номер", "Штрихкод", "Раздел 1С", "Количество", "Единица", "Расположение / склад", "Счёт", "Статус", "Первоначальная стоимость ОС, KZT", "Остаточная стоимость ОС, KZT", "GUID 1С", "Ключ строки 1С", "№"],
    [36, 25, 55, 20, 25, 25, 16, 16, 14, 35, 18, 25, 28, 28, 38, 45, 8]);
  absentAssets.forEach(({ externalId, asset }) => toAdd.addRow([
    safeText(asset.responsibleName), asset.quantity === 1 ? amountCell(asset.initialCost) : null,
    safeText(asset.name), safeText(asset.code), safeText(asset.inventoryNumber), safeText(asset.barcode), "ОС", asset.quantity, "шт",
    safeText(asset.location), "", safeText(asset.status), amountCell(asset.initialCost), amountCell(asset.residualCost),
    safeText(externalId), safeText(externalId), 0,
  ]));
  absentMaterials.forEach(({ key, material }) => toAdd.addRow([
    safeText(material.responsibleName), material.unitPrice == null ? null : Number(material.unitPrice),
    safeText(material.name), safeText(material.code), safeText(material.inventoryNumber), safeText(material.barcode), "МП",
    Number(material.quantity), safeText(material.unit), safeText(material.warehouseName ?? material.warehouseCode),
    safeText(material.accountCode), "Есть остаток", null, null, safeText(material.externalId), safeText(key), 0,
  ]));
  for (const column of [2, 13, 14]) toAdd.getColumn(column).numFmt = '#,##0.00';
  for (const worksheet of workbook.worksheets) {
    prioritizeOwnerAndPrice(worksheet, worksheet === materials ? matchedMaterialsStart : undefined);
    finishSheet(worksheet);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** Consistent leading columns and owner groups, with the most valuable items first. */
function prioritizeOwnerAndPrice(sheet: Worksheet, appendedStart?: number) {
  const columns = Array.from({ length: sheet.columnCount }, (_, index) => ({
    index: index + 1, header: String(sheet.getCell(5, index + 1).value ?? ""),
    width: sheet.getColumn(index + 1).width, numFmt: sheet.getColumn(index + 1).numFmt || "General",
  }));
  const owner = columns.find(column => /^(?:Ответственный|Ответственный в нашей базе)$/u.test(column.header))!;
  const price = columns.find(column => /^(?:Цена в нашей базе|Учётная цена|Цена за единицу|Первоначальная стоимость), KZT$/u.test(column.header))!;
  const name = columns.find(column => /^(?:Наименование|Наименование в нашей базе)$/u.test(column.header))!;
  const code = columns.find(column => /^(?:Код 1С|Код 1С в нашей базе)$/u.test(column.header))!;
  const leading = [owner, price, name, code];
  const order = [...leading, ...columns.filter(column => !leading.includes(column))];
  const rows = Array.from({ length: Math.max(0, sheet.rowCount - 5) }, (_, index) =>
    columns.map(column => sheet.getCell(index + 6, column.index).value));
  const compare = (left: unknown, right: unknown) => String(left ?? "").localeCompare(String(right ?? ""), "ru", { numeric: true, sensitivity: "base" });
  const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : -Infinity;
  const compareRows = (left: typeof rows[number], right: typeof rows[number]) => Number(!left[owner.index - 1]) - Number(!right[owner.index - 1])
    || compare(left[owner.index - 1], right[owner.index - 1])
    || (amount(right[price.index - 1]) === amount(left[price.index - 1]) ? 0 : amount(right[price.index - 1]) > amount(left[price.index - 1]) ? 1 : -1)
    || compare(left[name.index - 1], right[name.index - 1]) || compare(left[code.index - 1], right[code.index - 1]);
  const split = appendedStart === undefined ? rows.length : Math.max(0, appendedStart - 6);
  rows.splice(0, rows.length, ...rows.slice(0, split).sort(compareRows), ...rows.slice(split).sort(compareRows));
  order.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
    sheet.getColumn(index + 1).numFmt = column.numFmt;
    sheet.getCell(5, index + 1).value = column.header;
    rows.forEach((values, rowIndex) => {
      const cell = sheet.getCell(rowIndex + 6, index + 1);
      cell.value = column.header === "№" ? rowIndex + 1 : values[column.index - 1];
      cell.numFmt = column.numFmt;
    });
  });
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
      row.height = Math.min(120, Math.max(30, lines * 16 + 8));
      if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      row.getCell(2).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF00695C" } };
    }
  });
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, sheet.rowCount), column: sheet.columnCount } };
}
