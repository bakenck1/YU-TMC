import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const EXTERNAL_ID = "22222222-2222-4222-8222-222222222222";

test("candidate search combines the 1C GUID, normalized 1C code and exact inventory key", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("one_c_import_batch_rows")) {
        return {
          rows: [{ payload: {
            externalId: EXTERNAL_ID,
            code: "  code-42 ",
            inventoryNumber: "  АБ-１２  ",
          } }],
          rowCount: 1,
        };
      }
      if (sql.includes('from "yu_inventory"."items"')) {
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Кандидат по коду",
              inventory_number: "OTHER",
              one_c_code: "CODE-42",
              status: "active",
              version: 4,
              by_guid: false,
              by_code: true,
              by_inventory_number: false,
            },
            {
              id: "44444444-4444-4444-8444-444444444444",
              name: "Точный кандидат",
              inventory_number: "аб-12",
              one_c_code: "CODE-42",
              status: "active",
              version: 7,
              by_guid: true,
              by_code: true,
              by_inventory_number: true,
            },
          ],
          rowCount: 2,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const candidates = await new OneCReconciliationService(
    pool as unknown as Pick<Pool, "query" | "connect">,
  ).getRowCandidates(BATCH_ID, EXTERNAL_ID);

  const candidateQuery = calls.find(({ sql }) => sql.includes('from "yu_inventory"."items"'));
  assert.deepEqual(candidateQuery?.values, [EXTERNAL_ID, "CODE-42", "аб-12"]);
  assert.match(candidateQuery?.sql ?? "", /external_id=\$1/);
  assert.match(candidateQuery?.sql ?? "", /source_code/);
  assert.match(candidateQuery?.sql ?? "", /inventory_number_key=\$3/);
  assert.deepEqual(candidates, [
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Точный кандидат",
      inventoryNumber: "аб-12",
      oneCCode: "CODE-42",
      status: "active",
      version: 7,
      matchedBy: ["guid", "code", "inventory_number"],
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Кандидат по коду",
      inventoryNumber: "OTHER",
      oneCCode: "CODE-42",
      status: "active",
      version: 4,
      matchedBy: ["code"],
    },
  ]);
});

test("candidate search keeps an absent 1C code and inventory number neutral", async () => {
  let candidateValues: unknown[] | undefined;
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("one_c_import_batch_rows")) {
        return { rows: [{ payload: { externalId: EXTERNAL_ID, code: null, inventoryNumber: null } }], rowCount: 1 };
      }
      candidateValues = values;
      return { rows: [], rowCount: 0 };
    },
  };

  const candidates = await new OneCReconciliationService(
    pool as unknown as Pick<Pool, "query" | "connect">,
  ).getRowCandidates(BATCH_ID, EXTERNAL_ID);

  assert.deepEqual(candidates, []);
  assert.deepEqual(candidateValues, [EXTERNAL_ID, null, null]);
});

test("bulk decisions cannot inject one manual link target into multiple rows", async () => {
  const service = new OneCReconciliationService({} as Pick<Pool, "query" | "connect">);
  await assert.rejects(() => service.decideRowsBulk(BATCH_ID, {
    version: 1,
    externalIds: [EXTERNAL_ID],
    decision: { confirmLink: true, itemId: EXTERNAL_ID, expectedItemVersion: 1 },
  }, { userId: EXTERNAL_ID, role: "admin" }), /bulk_manual_link_not_allowed/);
});
