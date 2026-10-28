import assert from "node:assert/strict";
import type { Worksheet } from "exceljs";

export function workbookColumn(sheet: Worksheet, header: string): number {
  for (let column = 1; column <= sheet.columnCount; column++) {
    if (sheet.getCell(5, column).value === header) return column;
  }
  assert.fail(`Missing column ${header} in ${sheet.name}`);
}

export function workbookCell(sheet: Worksheet, header: string, row = 6) {
  return sheet.getCell(row, workbookColumn(sheet, header));
}

export function workbookRow(sheet: Worksheet, value: string, header = "ID карточки") {
  const column = workbookColumn(sheet, header);
  for (let row = 6; row <= sheet.rowCount; row++) {
    if (sheet.getCell(row, column).value === value) return sheet.getRow(row);
  }
  assert.fail(`Missing ${header}=${value} in ${sheet.name}`);
}
