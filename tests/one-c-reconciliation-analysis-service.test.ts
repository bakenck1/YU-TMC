import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";

const batchId = "11111111-1111-4111-8111-111111111111";
const externalId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";

test("the missing list requires analysis instead of reporting an empty result for untouched data", async () => {
  let queries = 0;
  const pool = { query: async () => { queries++; return { rows: [{ id: batchId, summary: {} }] }; } };
  const service = new OneCReconciliationService(pool as unknown as Pick<Pool, "query" | "connect">);
  await assert.rejects(service.listBatchRows(batchId, { page: 1, pageSize: 50, match: "missing" }), /one_c_analysis_required/);
  assert.equal(queries, 1);
});

for (const hasMatch of [true, false]) {
test(hasMatch ? "dry-run finds an active item by 1C code and writes row results in a batch" : "dry-run counts absent items even when publication is blocked by missing room and type", async () => {
  const header = Array(12).fill(""); header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
  const excelRow = Array(12).fill(""); excelRow[0] = 1; excelRow[1] = "Другой предмет №999/888"; excelRow[11] = 0;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, excelRow]), "Лист_1");
  const sourceFile = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
  let rowUpdateCount = 0;
  let rowUpdate: Record<string, unknown> | undefined;
  let savedSummary: Record<string, unknown> | undefined;
  const client = {
    release: () => undefined,
    query: async (sql: string, values?: unknown[]) => {
      if (sql === "begin" || sql === "commit") return { rows: [], rowCount: 0 };
      if (sql.includes("for update") && sql.includes("one_c_import_batches")) {
        return { rows: [{ id: batchId, version: 1, source_sha256: "a".repeat(64), summary: {} }], rowCount: 1 };
      }
      if (sql.startsWith("select *") && sql.includes("one_c_import_batch_rows")) {
        return { rows: [{ external_id: externalId, payload: {
          externalId, code: "00042", inventoryNumber: "DIFFERENT", barcode: null,
          name: "Название в 1С отличается", category: null, location: null,
          status: "Принято к учёту", responsibleName: null, responsibleExternalId: null,
          quantity: 1, residualCost: 100, acceptedAt: null, updatedAt: null,
        }, decision: null }], rowCount: 1 };
      }
      if (sql.includes("array_agg(br.original_value")) {
        return { rows: [
          { id: itemId, name: "Предмет сайта", inventory_number: "SITE-42", inventory_number_kind: "official", one_c_code: hasMatch ? "00042" : null, status: "active", version: 1, archived_at: null, official_barcodes: [] },
          { id: "55555555-5555-4555-8555-555555555555", name: "Удалённый предмет", inventory_number: "ARCHIVED-1", inventory_number_kind: "official", one_c_code: null, status: "active", version: 1, archived_at: new Date(), official_barcodes: [] },
        ], rowCount: 2 };
      }
      if (sql.startsWith("select external_id,item_id,source_code")) return { rows: [], rowCount: 0 };
      if (sql.includes("material_snapshots") && sql.startsWith("select")) return { rows: [{ id: "44444444-4444-4444-8444-444444444444", sha256: createHash("sha256").update(sourceFile).digest("hex"), byte_size: sourceFile.length, source_file: sourceFile }], rowCount: 1 };
      if (sql.includes("one_c_import_batch_rows") && sql.startsWith("select external_id,payload_hash,payload")) return { rows: [{ external_id: externalId, payload_hash: "b".repeat(64), payload: { externalId, code: "00042", inventoryNumber: "DIFFERENT", barcode: null, name: "Название в 1С отличается", status: "Принято к учёту" } }], rowCount: 1 };
      if (sql.includes("one_c_fixed_asset_inbox") && sql.startsWith("select")) return { rows: [{ external_id: externalId, payload_hash: "a".repeat(64), payload: { externalId, code: "OTHER", inventoryNumber: "DIFFERENT", barcode: null, name: "Другая запись текущего реестра", status: "Принято к учёту" } }], rowCount: 1 };
      if (sql.includes("update \"yu_inventory\".\"one_c_import_batch_rows\"")) {
        rowUpdateCount += 1;
        rowUpdate = (JSON.parse(String(values?.[1])) as Record<string, unknown>[])[0];
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("set state='review_required'")) {
        savedSummary = JSON.parse(String(values?.[1])) as Record<string, unknown>;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const pool = { connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) };

  const plan = await new OneCReconciliationService(
    pool as unknown as Pick<Pool, "query" | "connect">,
  ).analyzeBatch(batchId, { version: 1 });

  assert.equal(rowUpdateCount, 1);
  assert.equal(rowUpdate?.matched_item_id, hasMatch ? itemId : null);
  assert.equal(rowUpdate?.match_method, hasMatch ? "code" : "new_candidate");
  assert.equal(rowUpdate?.review_state, hasMatch ? "matched" : "blocked");
  assert.equal(savedSummary?.identifierMatched, hasMatch ? 1 : 0);
  assert.equal(savedSummary?.activeMatched, hasMatch ? 1 : 0);
  assert.equal(savedSummary?.missingInventory, hasMatch ? 0 : 1);
  assert.deepEqual((savedSummary?.inventoryAudit as Record<string, unknown>)?.counts, { total: 1, oneCOnly: hasMatch ? 1 : 0, excelOnly: 0, both: 0, missing: hasMatch ? 0 : 1, temporary: 0, possible: 0 });
  assert.equal((savedSummary?.inventoryAudit as Record<string, unknown>)?.algorithmVersion, 7);
  assert.equal(plan.link, hasMatch ? 1 : 0);
});
}
