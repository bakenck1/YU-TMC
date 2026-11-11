import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../lib/domain/application-error";
import { runOneCNightlyEnrichment } from "../lib/server/one-c-nightly-enrichment";
import type { InventoryAuditEnrichmentService } from "../lib/server/inventory-audit-enrichment-service";

const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", sessionVersion: 1 } as const;
const plan: Awaited<ReturnType<InventoryAuditEnrichmentService["previewCurrent"]>> = {
  runId: "current-registry", planHash: "a".repeat(64), rows: [],
  counts: { ready: 2, unchanged: 4, skipped: 3 }, responsibilityPolicy: "fill_missing",
  sources: { fixedAssets: 10, materials: 5, materialBalances: 5, cards: 9 },
};

test("nightly apply uses the live preview hash and actor with the guarded apply path", async () => {
  const result = { updated: 2, unchanged: 4, skipped: 3, planHash: plan.planHash };
  const summary = await runOneCNightlyEnrichment({
    previewCurrent: async user => { assert.equal(user, actor); return plan; },
    applyCurrent: async (input, user) => {
      assert.equal(user, actor);
      assert.deepEqual(input, { runId: plan.runId, planHash: plan.planHash });
      return result;
    },
  }, actor, true);
  assert.deepEqual(summary, { mode: "apply", checked: 0, counts: plan.counts, result });
  assert.equal("rows" in summary, false);
});

test("preview mode and an empty update plan never write cards", async () => {
  for (const apply of [false, true]) {
    const summary = await runOneCNightlyEnrichment({
      previewCurrent: async () => apply ? { ...plan, counts: { ...plan.counts, ready: 0 } } : plan,
      applyCurrent: async () => { throw new Error("unexpected write"); },
    }, actor, apply);
    assert.equal(summary.result, null);
  }
});

test("a failed preview never applies and a stale apply fails the nightly job", async () => {
  const failure = new ApplicationError("conflict", "inventory_audit_enrichment_stale");
  await assert.rejects(runOneCNightlyEnrichment({
    previewCurrent: async () => { throw failure; },
    applyCurrent: async () => { throw new Error("unexpected write"); },
  }, actor, true), error => error === failure);
  await assert.rejects(runOneCNightlyEnrichment({
    previewCurrent: async () => plan,
    applyCurrent: async () => { throw failure; },
  }, actor, true), error => error === failure);
});
