import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";

import {
  createInventoryTemplate,
  activeInventoryItems,
  exportInspectionResults,
  exportInventoryItems,
  parseInventoryWorkbook,
  type ImportRoom,
} from "../lib/server/excel/inventory-excel";

const ROOM: ImportRoom = {
  id: "11111111-1111-4111-8111-111111111111",
  buildingId: "22222222-2222-4222-8222-222222222222",
  buildingName: "Main Campus",
  designation: "101",
  floorNumber: 1,
  floorLabel: null,
  qrCode: "YU-ROOM",
  status: "active",
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

test("creates an empty import template with an authoritative room directory", async () => {
  const bytes = await createInventoryTemplate([ROOM]);
  const parsed = await parseInventoryWorkbook(bytes, [ROOM]);
  assert.deepEqual(parsed.preview, { rows: [], errors: [], validRowCount: 0 });

  const workbook = await loadWorkbook(bytes);
  assert.ok(workbook.getWorksheet("Items"));
  assert.equal(workbook.getWorksheet("Rooms")?.getCell("A2").text, ROOM.buildingName);
  assert.equal(workbook.getWorksheet("Rooms")?.getCell("B2").text, ROOM.designation);
});

test("validates Excel rows and rejects duplicate inventory numbers before import", async () => {
  const workbook = await loadWorkbook(await createInventoryTemplate([ROOM]));
  const sheet = workbook.getWorksheet("Items")!;
  sheet.addRow([
    "Monitor",
    "Display",
    "Equipment",
    "HP",
    "E24",
    2,
    125000.5,
    ROOM.buildingName,
    ROOM.designation,
    "INV-100",
  ]);
  sheet.addRow([
    "Desk",
    "",
    "Furniture",
    "",
    "",
    1,
    50000,
    ROOM.buildingName,
    ROOM.designation,
    "inv-100",
  ]);
  const parsed = await parseInventoryWorkbook(await writeWorkbook(workbook), [ROOM]);

  assert.equal(parsed.preview.rows.length, 2);
  assert.equal(parsed.preview.validRowCount, 1);
  assert.deepEqual(parsed.inputs[0], {
    name: "Monitor",
    description: "Display",
    itemType: "Equipment",
    brand: "HP",
    model: "E24",
    quantity: 2,
    unitPrice: 125000.5,
    roomId: ROOM.id,
    inventoryNumber: "INV-100",
  });
  assert.equal(parsed.preview.errors[0]?.code, "duplicate_inventory_number");
  assert.equal(parsed.preview.errors[0]?.rowNumber, 3);
});

test("exports empty workbooks for every PRD dataset without assuming shared columns", async () => {
  assert.ok((await exportInventoryItems([], "Inventory items")).byteLength > 0);
  assert.ok((await exportInventoryItems([], "Decommissioned")).byteLength > 0);
  assert.ok((await exportInspectionResults([])).byteLength > 0);
});

test("rejects non-ZIP uploads before invoking the workbook parser", async () => {
  await assert.rejects(
    parseInventoryWorkbook(new Uint8Array([1, 2, 3, 4]), [ROOM]),
    /invalid_excel_file/,
  );
});

test("rejects ZIP entries whose actual expansion exceeds their declared size", async () => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Items");
  sheet.addRow(["Name*", "Description", "Type*", "Brand", "Model", "Quantity*", "Unit price KZT*", "Building*", "Room*", "Inventory number"]);
  sheet.addRow(["A".repeat(10_000), "", "Equipment", "", "", 1, 1, ROOM.buildingName, ROOM.designation, "INV-ZIP"]);
  const bytes = await writeWorkbook(workbook);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let patched = false;
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const declaredSize = view.getUint32(offset + 24, true);
    if (declaredSize > 1_000) {
      view.setUint32(offset + 24, 1, true);
      patched = true;
      break;
    }
  }
  assert.equal(patched, true);
  await assert.rejects(parseInventoryWorkbook(bytes, [ROOM]), /invalid_excel_file/);
});

test("keeps decommissioned records out of active reports while preserving them for the separate export", () => {
  const active = { id: "a", status: "active" } as never;
  const maintenance = { id: "m", status: "maintenance" } as never;
  const decommissioned = { id: "d", status: "decommissioned" } as never;
  assert.deepEqual(activeInventoryItems([active, maintenance, decommissioned]).map((item) => item.id), ["a", "m"]);
});

async function loadWorkbook(bytes: Uint8Array) {
  const workbook = new Workbook();
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(data);
  return workbook;
}

async function writeWorkbook(workbook: Workbook) {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
