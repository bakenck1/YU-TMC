import "server-only";

import { inflateRawSync } from "node:zlib";
import { Workbook, type Cell, type Worksheet } from "exceljs";

import type { CreateInventoryItemInput, InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { InspectionDto } from "@/lib/contracts/inventory-inspections";
import type { InventoryExcelPreviewDto, InventoryExcelValidationError } from "@/lib/contracts/inventory-excel";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { ApplicationError } from "@/lib/domain/application-error";

const MAX_IMPORT_ROWS = 2_000;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 50 * 1024 * 1024;
const IMPORT_SHEET = "Items";
const HEADERS = {
  name: "Name*",
  description: "Description",
  itemType: "Type*",
  brand: "Brand",
  model: "Model",
  quantity: "Quantity*",
  unitPrice: "Unit price KZT*",
  building: "Building*",
  room: "Room*",
  inventoryNumber: "Inventory number",
} as const;
type HeaderKey = keyof typeof HEADERS;

export interface ImportRoom extends RoomDto {
  buildingName: string;
}

export interface ParsedInventoryWorkbook {
  preview: InventoryExcelPreviewDto;
  inputs: CreateInventoryItemInput[];
}

export function activeInventoryItems(items: InventoryItemDto[]) {
  return items.filter((item) => item.status !== "decommissioned");
}

export async function createInventoryTemplate(rooms: ImportRoom[]): Promise<Uint8Array> {
  const workbook = new Workbook();
  workbook.creator = "Yessenov University Inventory";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(IMPORT_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  configureImportColumns(sheet);
  styleHeader(sheet);
  const instructions = workbook.addWorksheet("Instructions");
  instructions.columns = [{ header: "Import instructions", key: "text", width: 100 }];
  styleHeader(instructions);
  [
    "Fill the Items sheet without changing its headers.",
    "Use an exact Building and Room pair from the Rooms sheet.",
    "Inventory number may be empty; the system will assign a temporary number.",
    "Quantity must be an integer and unit price must be a non-negative number with at most two decimal places.",
    "The entire file is validated before import; any error prevents all rows from being imported.",
  ].forEach((text) => instructions.addRow({ text }));
  const directory = workbook.addWorksheet("Rooms");
  directory.columns = [
    { header: "Building", key: "building", width: 42 },
    { header: "Room", key: "room", width: 20 },
    { header: "Floor", key: "floor", width: 12 },
  ];
  rooms.forEach((room) => directory.addRow({
    building: room.buildingName,
    room: room.designation,
    floor: room.floorLabel ?? room.floorNumber,
  }));
  styleHeader(directory);
  return workbookBytes(workbook);
}

export async function parseInventoryWorkbook(
  bytes: Uint8Array,
  rooms: ImportRoom[],
): Promise<ParsedInventoryWorkbook> {
  assertSafeXlsxArchive(bytes);
  const workbook = new Workbook();
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(data);
  const sheet = workbook.getWorksheet(IMPORT_SHEET) ?? workbook.worksheets[0];
  if (!sheet) {
    return invalidWorkbook("missing_headers");
  }
  const headerIndexes = readHeaderIndexes(sheet);
  const missingHeaders = (Object.keys(HEADERS) as HeaderKey[]).filter(
    (key) => headerIndexes[key] === undefined,
  );
  if (missingHeaders.length) {
    return invalidWorkbook("missing_headers", missingHeaders.join(", "));
  }

  const errors: InventoryExcelValidationError[] = [];
  const inputs: CreateInventoryItemInput[] = [];
  const rows: InventoryExcelPreviewDto["rows"] = [];
  const roomLookup = new Map(
    rooms.map((room) => [roomKey(room.buildingName, room.designation), room]),
  );
  const inventoryNumbers = new Map<string, number>();
  let nonEmptyRows = 0;

  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (isBlankImportRow(row.values)) continue;
    nonEmptyRows += 1;
    if (nonEmptyRows > MAX_IMPORT_ROWS) {
      errors.push({ rowNumber, field: "file", code: "too_many_rows" });
      break;
    }
    const rowErrors: InventoryExcelValidationError[] = [];
    const read = (key: HeaderKey) => {
      const cell = row.getCell(headerIndexes[key]!);
      if (isFormulaCell(cell)) {
        rowErrors.push({ rowNumber, field: HEADERS[key], code: "formula_not_allowed" });
        return "";
      }
      return cell.text.normalize("NFKC").trim();
    };
    const name = read("name");
    const description = read("description");
    const itemType = read("itemType");
    const brand = read("brand");
    const model = read("model");
    const building = read("building");
    const roomName = read("room");
    const inventoryNumber = read("inventoryNumber");
    const quantityText = read("quantity");
    const unitPriceText = read("unitPrice");
    validateRequired(rowErrors, rowNumber, "Name*", name);
    validateRequired(rowErrors, rowNumber, "Type*", itemType);
    validateRequired(rowErrors, rowNumber, "Building*", building);
    validateRequired(rowErrors, rowNumber, "Room*", roomName);
    validateLength(rowErrors, rowNumber, "Name*", name, 160);
    validateLength(rowErrors, rowNumber, "Description", description, 4_000);
    validateLength(rowErrors, rowNumber, "Type*", itemType, 120);
    validateLength(rowErrors, rowNumber, "Brand", brand, 120);
    validateLength(rowErrors, rowNumber, "Model", model, 160);
    validateLength(rowErrors, rowNumber, "Inventory number", inventoryNumber, 64);
    const quantity = parseInteger(quantityText);
    const unitPrice = parseMoney(unitPriceText);
    if (quantity === null) {
      rowErrors.push({ rowNumber, field: "Quantity*", code: "invalid_quantity" });
    }
    if (unitPrice === null) {
      rowErrors.push({ rowNumber, field: "Unit price KZT*", code: "invalid_price" });
    }
    const room = roomLookup.get(roomKey(building, roomName));
    if (building && roomName && !room) {
      rowErrors.push({ rowNumber, field: "Building* / Room*", code: "room_not_found" });
    }
    if (inventoryNumber) {
      const numberKey = inventoryNumber.normalize("NFKC").toLocaleUpperCase("en-US");
      const firstRow = inventoryNumbers.get(numberKey);
      if (firstRow !== undefined) {
        rowErrors.push({ rowNumber, field: "Inventory number", code: "duplicate_inventory_number" });
      } else {
        inventoryNumbers.set(numberKey, rowNumber);
      }
    }
    rows.push({
      rowNumber,
      name,
      inventoryNumber,
      itemType,
      building,
      room: roomName,
      quantity,
      unitPrice,
    });
    errors.push(...rowErrors);
    if (!rowErrors.length && room && quantity !== null && unitPrice !== null) {
      inputs.push({
        name,
        description: description || null,
        itemType,
        brand: brand || null,
        model: model || null,
        quantity,
        unitPrice,
        roomId: room.id,
        inventoryNumber: inventoryNumber || null,
      });
    }
  }
  return {
    preview: { rows, errors, validRowCount: inputs.length },
    inputs,
  };
}

/**
 * Excel workbooks are ZIP archives. Check the central directory before
 * ExcelJS inflates any entry so a small upload cannot expand without bound.
 */
function assertSafeXlsxArchive(bytes: Uint8Array) {
  const minimumEndRecordSize = 22;
  const searchStart = Math.max(0, bytes.byteLength - 65_557);
  let endRecord = -1;
  for (let offset = bytes.byteLength - minimumEndRecordSize; offset >= searchStart; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) throw invalidExcelFile();
  const diskNumber = readUint16(bytes, endRecord + 4);
  const directoryDisk = readUint16(bytes, endRecord + 6);
  const entriesOnDisk = readUint16(bytes, endRecord + 8);
  const entries = readUint16(bytes, endRecord + 10);
  const directorySize = readUint32(bytes, endRecord + 12);
  const directoryOffset = readUint32(bytes, endRecord + 16);
  const commentLength = readUint16(bytes, endRecord + 20);
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entries ||
    entries > MAX_ARCHIVE_ENTRIES ||
    directoryOffset + directorySize > endRecord ||
    endRecord + minimumEndRecordSize + commentLength !== bytes.byteLength
  ) {
    throw invalidExcelFile();
  }
  let cursor = directoryOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < entries; index += 1) {
    if (readUint32(bytes, cursor) !== 0x02014b50 || cursor + 46 > bytes.byteLength) {
      throw invalidExcelFile();
    }
    const compressedSize = readUint32(bytes, cursor + 20);
    const uncompressedSize = readUint32(bytes, cursor + 24);
    const flags = readUint16(bytes, cursor + 8);
    const compressionMethod = readUint16(bytes, cursor + 10);
    const nameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const localHeaderOffset = readUint32(bytes, cursor + 42);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      (flags & 0x1) !== 0 ||
      (compressionMethod !== 0 && compressionMethod !== 8) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize > MAX_UNCOMPRESSED_ARCHIVE_BYTES ||
      nextCursor > directoryOffset + directorySize ||
      readUint32(bytes, localHeaderOffset) !== 0x04034b50
    ) {
      throw invalidExcelFile();
    }
    const localFlags = readUint16(bytes, localHeaderOffset + 6);
    const localCompressionMethod = readUint16(bytes, localHeaderOffset + 8);
    const localNameLength = readUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (
      localFlags !== flags ||
      localCompressionMethod !== compressionMethod ||
      dataEnd > directoryOffset ||
      dataEnd < dataOffset
    ) {
      throw invalidExcelFile();
    }

    let actualSize: number;
    if (compressionMethod === 0) {
      actualSize = compressedSize;
    } else {
      try {
        actualSize = inflateRawSync(bytes.subarray(dataOffset, dataEnd), {
          maxOutputLength: Math.min(
            uncompressedSize + 1,
            MAX_UNCOMPRESSED_ARCHIVE_BYTES - uncompressedBytes + 1,
          ),
        }).byteLength;
      } catch {
        throw invalidExcelFile();
      }
    }
    if (actualSize !== uncompressedSize) throw invalidExcelFile();
    uncompressedBytes += actualSize;
    if (uncompressedBytes > MAX_UNCOMPRESSED_ARCHIVE_BYTES) throw invalidExcelFile();
    cursor = nextCursor;
  }
  if (cursor !== directoryOffset + directorySize) throw invalidExcelFile();
}

function readUint16(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw invalidExcelFile();
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw invalidExcelFile();
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidExcelFile() {
  return new ApplicationError("validation", "invalid_excel_file");
}

export async function exportInventoryItems(
  items: InventoryItemDto[],
  title: string,
  visibleColumns?: readonly string[],
): Promise<Uint8Array> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1 }] });
  const allColumns = [
    { header: "Name", key: "name", width: 34 },
    { header: "Inventory number", key: "inventoryNumber", width: 24 },
    { header: "QR code", key: "qrCode", width: 28 },
    { header: "Type", key: "itemType", width: 22 },
    { header: "Brand", key: "brand", width: 18 },
    { header: "Model", key: "model", width: 22 },
    { header: "Description", key: "description", width: 42 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Unit price KZT", key: "unitPrice", width: 18 },
    { header: "Total KZT", key: "total", width: 18 },
    { header: "Building", key: "building", width: 36 },
    { header: "Room", key: "room", width: 14 },
    { header: "Status", key: "status", width: 18 },
    { header: "Responsible", key: "responsible", width: 28 },
    { header: "Created", key: "createdAt", width: 22 },
    { header: "Updated", key: "updatedAt", width: 22 },
    { header: "Exported at", key: "exportedAt", width: 22 },
  ] as const;
  const requested = new Set(visibleColumns ?? [
    "name", "inventoryNumber", "itemType", "brand", "model", "quantity", "unitPrice",
    "total", "building", "room", "status", "responsible", "createdAt", "updatedAt", "exportedAt",
  ]);
  requested.add("name");
  sheet.columns = allColumns.filter((column) => requested.has(column.key));
  const exportedAt = new Date();
  items.forEach((item) => sheet.addRow({
    name: item.name,
    inventoryNumber: item.inventoryNumber,
    qrCode: item.qrCode ?? "",
    itemType: item.itemType,
    brand: item.brand ?? "",
    model: item.model ?? "",
    description: item.description ?? "",
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.quantity * item.unitPrice,
    building: item.room.buildingName,
    room: item.room.designation,
    status: item.status,
    responsible: item.responsible?.name ?? "",
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    exportedAt,
  }));
  styleDataSheet(sheet);
  return workbookBytes(workbook);
}

export async function exportInspectionResults(inspections: InspectionDto[]): Promise<Uint8Array> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Inspection results", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Session", key: "inspection", width: 30 },
    { header: "Session status", key: "status", width: 20 },
    { header: "Building", key: "building", width: 34 },
    { header: "Room", key: "room", width: 14 },
    { header: "Item", key: "item", width: 34 },
    { header: "Inventory number", key: "inventoryNumber", width: 24 },
    { header: "Result", key: "result", width: 18 },
    { header: "Comment", key: "comment", width: 42 },
    { header: "Recorded at", key: "recordedAt", width: 22 },
  ];
  inspections.forEach((inspection) => inspection.items.forEach((expected) => {
    const result = inspection.results.find((entry) => entry.itemId === expected.itemId);
    const room = inspection.rooms.find((entry) => entry.id === expected.inspectionRoomId);
    sheet.addRow({
      inspection: inspection.name,
      status: inspection.status,
      building: room?.buildingName ?? "",
      room: room?.roomDesignation ?? "",
      item: expected.itemName,
      inventoryNumber: expected.inventoryNumber,
      result: result?.result ?? "not_checked",
      comment: result?.comment ?? "",
      recordedAt: result ? new Date(result.createdAt) : "",
    });
  }));
  styleDataSheet(sheet);
  return workbookBytes(workbook);
}

function configureImportColumns(sheet: Worksheet) {
  sheet.columns = [
    { header: HEADERS.name, key: "name", width: 34 },
    { header: HEADERS.description, key: "description", width: 42 },
    { header: HEADERS.itemType, key: "itemType", width: 22 },
    { header: HEADERS.brand, key: "brand", width: 18 },
    { header: HEADERS.model, key: "model", width: 22 },
    { header: HEADERS.quantity, key: "quantity", width: 14 },
    { header: HEADERS.unitPrice, key: "unitPrice", width: 20 },
    { header: HEADERS.building, key: "building", width: 38 },
    { header: HEADERS.room, key: "room", width: 16 },
    { header: HEADERS.inventoryNumber, key: "inventoryNumber", width: 24 },
  ];
}

function styleHeader(sheet: Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } };
  row.alignment = { vertical: "middle" };
  row.height = 24;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

function styleDataSheet(sheet: Worksheet) {
  styleHeader(sheet);
  setNumberFormat(sheet, "unitPrice", "#,##0.00");
  setNumberFormat(sheet, "total", "#,##0.00");
  setNumberFormat(sheet, "createdAt", "yyyy-mm-dd hh:mm");
  setNumberFormat(sheet, "updatedAt", "yyyy-mm-dd hh:mm");
  setNumberFormat(sheet, "recordedAt", "yyyy-mm-dd hh:mm");
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    }
  });
}

function setNumberFormat(sheet: Worksheet, key: string, format: string) {
  const column = sheet.columns.find((entry) => entry.key === key);
  if (column) column.numFmt = format;
}

function readHeaderIndexes(sheet: Worksheet): Partial<Record<HeaderKey, number>> {
  const indexes: Partial<Record<HeaderKey, number>> = {};
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const value = cell.text.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    for (const [key, header] of Object.entries(HEADERS) as [HeaderKey, string][]) {
      if (value === header.toLocaleLowerCase("en-US")) indexes[key] = columnNumber;
    }
  });
  return indexes;
}

function invalidWorkbook(
  code: InventoryExcelValidationError["code"],
  field = "file",
): ParsedInventoryWorkbook {
  return {
    preview: {
      rows: [],
      errors: [{ rowNumber: 1, field, code }],
      validRowCount: 0,
    },
    inputs: [],
  };
}

function isBlankImportRow(values: unknown) {
  return !Array.isArray(values) || values.slice(1).every((value) => value === null || value === undefined || String(value).trim() === "");
}

function isFormulaCell(cell: Cell) {
  return Boolean(cell.value && typeof cell.value === "object" && "formula" in cell.value);
}

function validateRequired(
  errors: InventoryExcelValidationError[],
  rowNumber: number,
  field: string,
  value: string,
) {
  if (!value) errors.push({ rowNumber, field, code: "required" });
}

function validateLength(
  errors: InventoryExcelValidationError[],
  rowNumber: number,
  field: string,
  value: string,
  max: number,
) {
  if ([...value].length > max) errors.push({ rowNumber, field, code: "too_long" });
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000 ? parsed : null;
}

function parseMoney(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 999_999_999_999.99 ? parsed : null;
}

function roomKey(building: string, room: string) {
  return `${building.normalize("NFKC").trim().toLocaleLowerCase("ru-RU")}\u0000${room.normalize("NFKC").trim().toLocaleLowerCase("ru-RU")}`;
}

async function workbookBytes(workbook: Workbook): Promise<Uint8Array> {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
