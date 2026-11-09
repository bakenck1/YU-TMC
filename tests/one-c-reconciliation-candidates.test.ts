import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const EXTERNAL_ID = "22222222-2222-4222-8222-222222222222";

test("bulk decisions cannot inject one manual link target into multiple rows", async () => {
  const service = new OneCReconciliationService({} as Pick<Pool, "query" | "connect">);
  await assert.rejects(() => service.decideRowsBulk(BATCH_ID, {
    version: 1,
    externalIds: [EXTERNAL_ID],
    decision: { confirmLink: true, itemId: EXTERNAL_ID, expectedItemVersion: 1 },
  }, { userId: EXTERNAL_ID, role: "admin" }), /bulk_manual_link_not_allowed/);
});
