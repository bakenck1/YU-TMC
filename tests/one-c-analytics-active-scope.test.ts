import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { Workbook } from "exceljs";
import { getOneCAnalyticsSnapshot } from "../lib/server/one-c-analytics-service";
import { getOneCMatchedCards } from "../lib/one-c-matched-cards";
import { exportOneCAnalyticsExcel } from "../lib/server/excel/one-c-analytics-excel";

test("analytics, matched lists and Excel use only active nonarchived cards", async () => {
  const card = (id: string, status = "active", archived_at: string | null = null) => ({
    id, status, archived_at, name: id, inventory_number: `INV-${id}`, inventory_number_kind: "official",
    one_c_code: null, version: 1, quantity: 3, unit_price: "10.00", item_section: "general",
    official_barcodes: [], local_barcodes: [], responsible_name: null,
  });
  const cards = [card("active"), ...["maintenance", "broken", "decommissioned", "decommissioned_in_use"].map(status => card(status, status)), card("archived", "active", "2026-11-03")];
  const asset = (id: string) => ({ external_id: id, received_at: "2026-11-03T00:00:00Z", payload: {
    externalId: id, name: id, inventoryNumber: `INV-${id}`, code: `CODE-${id}`, barcode: null,
    status: "Принято к учёту", quantity: 1, initialCost: "100", residualCost: "50",
    category: null, location: null, responsibleName: null, responsibleExternalId: null, acceptedAt: null, updatedAt: null,
  } });
  let released = false;
  const client = {
    release() { released = true; },
    async query(sql: string) {
      if (sql.includes("from yu_inventory.items i")) {
        // Enforce the database scope before identifiers enter the matching algorithm.
        assert.match(sql, /where i\.archived_at is null and i\.status = 'active'/);
        return { rows: cards.filter(row => row.status === "active" && row.archived_at === null) };
      }
      if (sql.includes("one_c_fixed_asset_inbox")) return { rows: [asset("active"), asset("maintenance")] };
      if (sql.includes("transaction_timestamp")) return { rows: [{ calculated_at: "2026-11-03T00:00:00Z" }] };
      return { rows: [] };
    },
  };
  const snapshot = await getOneCAnalyticsSnapshot({ connect: async () => client } as unknown as Pick<Pool, "connect">);
  assert.equal(released, true);
  assert.deepEqual(snapshot.analytics.inventory, { total: 1, active: 1, quantity: 3 });
  assert.equal(snapshot.analytics.reconciliation.total, 1);
  assert.equal(snapshot.analytics.reconciliation.assetsWithoutCandidate, 1);
  assert.deepEqual(snapshot.inventory.map(row => row.id), ["active"]);
  assert.deepEqual(snapshot.rows.map(row => row.itemId), ["active"]);
  assert.deepEqual(getOneCMatchedCards(snapshot).map(row => row.id), ["active"]);

  const workbook = new Workbook();
  const bytes = await exportOneCAnalyticsExcel(snapshot);
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const matched = workbook.getWorksheet("Совпадения 1С")!;
  const cells: unknown[] = [];
  matched.eachRow(row => row.eachCell(cell => cells.push(cell.value)));
  assert.ok(cells.includes("active"));
  for (const excluded of cards.slice(1)) assert.ok(!cells.includes(excluded.id), excluded.id);
});
