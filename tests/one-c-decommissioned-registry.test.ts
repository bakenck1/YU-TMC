import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";

test("1C decommissioned registry is read-only, status-scoped and paginated", async () => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      capturedSql = sql;
      capturedValues = values ?? [];
      return {
        rows: [{
          external_id: "11111111-1111-4111-8111-111111111111",
          code: "0001",
          inventory_number: "2413/1",
          name: "Принтер",
          location: "АУП",
          responsible_name: "Иванов И.И.",
          residual_cost: "0",
          last_seen_at: new Date("2026-09-22T08:12:17Z"),
          linked_item_id: null,
          linked_item_name: null,
          linked_item_status: null,
          total: 648,
        }],
        rowCount: 1,
      };
    },
  };

  const result = await new OneCReconciliationService(
    pool as unknown as Pick<Pool, "query" | "connect">,
  ).listDecommissionedAssets({ page: 2, pageSize: 50, search: "100%_test" });

  assert.equal(result.total, 648);
  assert.equal(result.page, 2);
  assert.equal(result.data[0]?.inventoryNumber, "2413/1");
  assert.equal(result.data[0]?.lastSeenAt, "2026-09-22T08:12:17.000Z");
  assert.deepEqual(capturedValues, ["Снято с учёта", "%100\\%\\_test%", 50, 50]);
  assert.match(capturedSql, /payload->>'status' = \$1/);
  assert.match(capturedSql, /item_one_c_links/);
  assert.match(capturedSql, /count\(\*\) over\(\)/);
  assert.doesNotMatch(capturedSql, /\b(?:insert|update|delete)\b/i);
});

test("1C decommissioned registry clamps unsafe paging inputs", async () => {
  let capturedValues: unknown[] = [];
  const pool = {
    query: async (_sql: string, values?: unknown[]) => {
      capturedValues = values ?? [];
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await new OneCReconciliationService(
    pool as unknown as Pick<Pool, "query" | "connect">,
  ).listDecommissionedAssets({ page: -5, pageSize: 10_000 });

  assert.deepEqual(capturedValues, ["Снято с учёта", 100, 0]);
  assert.deepEqual(result, { data: [], page: 1, pageSize: 100, total: 0 });
});
