import "server-only";

import { Workbook, type Worksheet } from "exceljs";

type JsonRecord = Record<string, unknown>;

export type OneCReconciliationExport = {
  batch: JsonRecord;
  rows: JsonRecord[];
};

const REVIEW_LABELS: Record<string, string> = {
  pending: "Ожидает анализа",
  ready: "Готово",
  matched: "Найдено совпадение",
  conflict: "Конфликт",
  blocked: "Заблокировано",
  excluded: "Исключено",
  approved: "Подтверждено",
  published: "Опубликовано",
  failed: "Ошибка",
};

const ACTION_LABELS: Record<string, string> = {
  create: "Создать карточку",
  link: "Связать с существующей",
  update: "Обновить",
  exclude: "Исключить",
  manual_review: "Ручная проверка",
  no_change: "Без изменений",
  blocked: "Заблокировано",
  conflict: "Конфликт",
};

const ISSUE_LABELS: Record<string, string> = {
  non_physical_asset: "Не является физическим движимым ОС",
  missing_inventory_number: "Нет инвентарного номера",
  missing_room: "Не выбран физический кабинет",
  unsupported_item_type: "Не выбран тип ТМЦ",
  negative_residual_value: "Отрицательная остаточная стоимость",
  zero_residual_value_unconfirmed: "Нулевая стоимость не подтверждена",
  quantity_requires_review: "Количество требует проверки",
  responsible_unassigned: "Ответственный не указан",
  accounting_status_requires_review: "Статус учета требует проверки",
  invalid_one_c_barcode: "Некорректный штрихкод 1С",
  identifier_conflict: "Конфликт идентификаторов",
};

export async function exportOneCReconciliation(data: OneCReconciliationExport): Promise<Uint8Array> {
  const workbook = new Workbook();
  workbook.creator = "Yessenov University Inventory";
  workbook.created = new Date();
  addSummarySheet(workbook, data);
  addRowsSheet(workbook, data.rows);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function addSummarySheet(workbook: Workbook, data: OneCReconciliationExport) {
  const sheet = workbook.addWorksheet("Сводка", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Показатель", key: "label", width: 38 },
    { header: "Значение", key: "value", width: 64 },
  ];
  const counts = new Map<string, number>();
  for (const row of data.rows) {
    const state = text(row.review_state) || "pending";
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const batch = data.batch;
  const summary = record(batch.summary);
  sheet.addRows([
    { label: "Получено строк", value: data.rows.length },
    { label: "Состояние пакета", value: text(batch.state) },
    { label: "Имя исходного файла", value: text(batch.source_filename) || "Не указано" },
    { label: "SHA-256", value: text(batch.source_sha256) },
    { label: "Вид снимка", value: text(summary.snapshotKind) || "Не указано" },
    ...[...counts.entries()].sort().map(([state, count]) => ({
      label: REVIEW_LABELS[state] ?? state,
      value: count,
    })),
  ]);
  styleSheet(sheet, 2);
}

function addRowsSheet(workbook: Workbook, rows: JsonRecord[]) {
  const sheet = workbook.addWorksheet("Все ОС", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Статус проверки", key: "reviewState", width: 24 },
    { header: "Предлагаемое действие", key: "action", width: 26 },
    { header: "GUID 1С", key: "externalId", width: 38 },
    { header: "Код 1С", key: "code", width: 18 },
    { header: "Инвентарный номер", key: "inventoryNumber", width: 24 },
    { header: "Штрихкод 1С", key: "barcode", width: 24 },
    { header: "Наименование", key: "name", width: 60 },
    { header: "Категория 1С", key: "category", width: 28 },
    { header: "Подразделение 1С", key: "location", width: 30 },
    { header: "Ответственный", key: "responsible", width: 34 },
    { header: "ID ответственного 1С", key: "responsibleId", width: 28 },
    { header: "Статус учета 1С", key: "accountingStatus", width: 24 },
    { header: "Количество", key: "quantity", width: 14 },
    { header: "Остаточная стоимость, KZT", key: "residualCost", width: 24 },
    { header: "Дата принятия", key: "acceptedAt", width: 20 },
    { header: "Обновлено в 1С", key: "updatedAt", width: 20 },
    { header: "Найденный ТМЦ", key: "matchedItem", width: 42 },
    { header: "Инв. номер найденного ТМЦ", key: "matchedInventoryNumber", width: 28 },
    { header: "Проблемы", key: "issues", width: 64 },
    { header: "Решение администратора", key: "decision", width: 44 },
    { header: "ID опубликованной карточки", key: "publishedItemId", width: 38 },
  ];
  for (const source of rows) {
    const payload = record(source.payload);
    const issues = Array.isArray(source.issues) ? source.issues : [];
    const row = sheet.addRow({
      reviewState: REVIEW_LABELS[text(source.review_state)] ?? text(source.review_state),
      action: ACTION_LABELS[text(source.proposed_action)] ?? text(source.proposed_action),
      externalId: text(source.external_id),
      code: text(payload.code),
      inventoryNumber: text(payload.inventoryNumber),
      barcode: text(payload.barcode),
      name: text(payload.name),
      category: text(payload.category),
      location: text(payload.location),
      responsible: text(payload.responsibleName),
      responsibleId: text(payload.responsibleExternalId),
      accountingStatus: text(payload.status),
      quantity: numberOrBlank(payload.quantity),
      residualCost: numberOrBlank(payload.residualCost),
      acceptedAt: dateOrBlank(payload.acceptedAt),
      updatedAt: dateOrBlank(payload.updatedAt),
      matchedItem: text(source.matched_item_name),
      matchedInventoryNumber: text(source.matched_inventory_number),
      issues: issues.map((value) => {
        const code = text(record(value).code);
        return ISSUE_LABELS[code] ?? code;
      }).filter(Boolean).join("; "),
      decision: decisionLabel(record(source.decision)),
      publishedItemId: text(source.published_item_id),
    });
    if (row.number % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  }
  sheet.getColumn("quantity").numFmt = "#,##0.00";
  sheet.getColumn("residualCost").numFmt = "#,##0.00";
  sheet.getColumn("acceptedAt").numFmt = "yyyy-mm-dd";
  sheet.getColumn("updatedAt").numFmt = "yyyy-mm-dd hh:mm";
  styleSheet(sheet, sheet.columnCount);
}

function styleSheet(sheet: Worksheet, columns: number) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002060" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 32;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function numberOrBlank(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : ""; }
function dateOrBlank(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date;
}
function decisionLabel(decision: JsonRecord) {
  if (decision.exclude === true) return "Исключить";
  if (decision.confirmLink === true) return "Связать без изменения";
  if (decision.confirmCreate === true) return "Создать карточку";
  return "";
}
