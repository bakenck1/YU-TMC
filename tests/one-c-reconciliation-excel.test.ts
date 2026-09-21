import assert from "node:assert/strict";
import test from "node:test";
import { Workbook } from "exceljs";

import { exportOneCReconciliation } from "../lib/server/excel/one-c-reconciliation-excel";

test("exports every 1C reconciliation row with Russian labels and responsible details", async () => {
  const bytes = await exportOneCReconciliation({
    batch: {
      state: "review_required",
      source_filename: null,
      source_sha256: "a".repeat(64),
      summary: { snapshotKind: "unverified_legacy_snapshot" },
    },
    rows: [
      {
        external_id: "0036a243-6f00-11f1-a281-7cc25579bdd7",
        review_state: "blocked",
        proposed_action: "manual_review",
        payload: {
          code: "000010363",
          inventoryNumber: "2416/1285",
          barcode: null,
          name: "Моноблок Lenovo",
          category: "Оборудование",
          location: "АУП",
          responsibleName: "Иванов Иван",
          responsibleExternalId: "EMP-1",
          status: "На учете",
          quantity: 1,
          residualCost: 475600,
          acceptedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-09-19T00:00:00.000Z",
        },
        matched_item_name: null,
        matched_inventory_number: null,
        issues: [{ code: "missing_room" }, { code: "unsupported_item_type" }],
        decision: null,
        published_item_id: null,
      },
      {
        external_id: "025502ba-4a8a-11eb-92ea-91be2fbaf6d0",
        review_state: "matched",
        proposed_action: "link",
        payload: { code: "000000675", inventoryNumber: "2413/0733", name: "Блок управления", quantity: 1 },
        matched_item_name: "Блок управления Bosh CCS",
        matched_inventory_number: "2413/0733",
        issues: [],
        decision: { confirmLink: true },
      },
    ],
  });

  const workbook = new Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const summary = workbook.getWorksheet("Сводка")!;
  const rows = workbook.getWorksheet("Все ОС")!;
  assert.equal(summary.getCell("B2").value, 2);
  assert.equal(rows.rowCount, 3);
  assert.equal(rows.getCell("A2").value, "Заблокировано");
  assert.equal(rows.getCell("C2").value, "0036a243-6f00-11f1-a281-7cc25579bdd7");
  assert.equal(rows.getCell("E2").value, "2416/1285");
  assert.equal(rows.getCell("J2").value, "Иванов Иван");
  assert.equal(rows.getCell("N2").value, 475600);
  assert.match(rows.getCell("S2").text, /Не выбран физический кабинет/);
  assert.equal(rows.getCell("Q3").value, "Блок управления Bosh CCS");
  assert.equal(rows.getCell("T3").value, "Связать без изменения");
  assert.equal(rows.views[0]?.state, "frozen");
  assert.ok(rows.autoFilter);
});
