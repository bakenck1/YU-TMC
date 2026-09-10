import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { captureProductionCapacityScenarios } from "../scripts/capacity/production-scenarios";

test("capacity manifest covers every agreed cardinality and load dimension", async () => {
  const dataset = JSON.parse(await readFile("scripts/capacity/dataset-v1.json", "utf8"));
  assert.equal(dataset.version, "capacity-v1");
  for (const key of ["users", "oneCInbox", "items", "photos", "legacyTransfers", "tmcTransferRequests", "notificationEvents", "auditEvents"]) {
    assert.ok(Number.isSafeInteger(dataset.cardinality[key]) && dataset.cardinality[key] > 0, key);
  }
  for (const key of ["samples", "warmups", "concurrentScanners", "poolSize", "workerConcurrency", "workerBatchSize", "workerLeaseSeconds", "gracefulShutdownBudgetMs", "statementTimeoutMs"]) {
    assert.ok(Number.isSafeInteger(dataset.load[key]) && dataset.load[key] > 0, key);
  }
});

test("capacity SQL is captured from production repositories and stays read-only", async () => {
  const scenarios = await captureProductionCapacityScenarios("2026-09-09T12:00:00.000Z");
  assert.deepEqual(Object.keys(scenarios).sort(), [
    "asset_loss_list", "dockflow_projection", "export_source", "inventory_list",
    "tmc_history", "tmc_notifications", "worker_due_scan",
  ]);
  assert.equal(scenarios.tmc_history.length, 103);
  assert.equal(scenarios.tmc_notifications.length, 2);
  for (const [name, statements] of Object.entries(scenarios)) {
    assert.ok(statements.length > 0, name);
    for (const { sql } of statements) {
      const normalized = sql.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim();
      assert.match(normalized, /^(?:select|with)\b/i, name);
      assert.doesNotMatch(normalized, /\b(?:insert|update|delete|merge|truncate|alter|drop|create|copy|call)\b/i, name);
    }
  }
});

test("measurement runner is fail-closed read-only and excludes secrets from reports", async () => {
  const source = await readFile("scripts/capacity/measure.mjs", "utf8");
  assert.match(source, /default_transaction_read_only=on/);
  assert.match(source, /begin read only/i);
  assert.match(source, /EXPLAIN \(ANALYZE, BUFFERS, FORMAT JSON\)/i);
  const reportShape = source.slice(source.indexOf("const report ="), source.indexOf("await mkdir"));
  assert.doesNotMatch(reportShape, /databaseUrl|connectionString|DATABASE_URL|password/i);
  assert.match(source, /This is a nightly\/release baseline, not a PR timing gate/);
});

test("disposable seed requires an explicit loopback-only capability", async () => {
  const source = await readFile("scripts/capacity/seed-disposable.mjs", "utf8");
  assert.match(source, /CAPACITY_ALLOW_DISPOSABLE_SEED !== "1"/);
  assert.match(source, /capacity-local-/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /Synthetic/);
});

test("committed baseline contains complete, credential-free evidence and actionable breaches", async () => {
  const raw = await readFile("docs/capacity-baseline-v1.json", "utf8");
  const report = JSON.parse(raw);
  assert.equal(report.dataset.version, "capacity-v1");
  assert.deepEqual(Object.keys(report.queries).sort(), [
    "asset_loss_list", "dockflow_projection", "export_source", "inventory_list",
    "tmc_history", "tmc_notifications", "worker_due_scan",
  ]);
  for (const query of Object.values(report.queries) as Array<{ plans: unknown[]; fingerprint: string; samplesMs: number[] }>) {
    assert.ok(query.plans.length > 0);
    assert.match(query.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(query.samplesMs.length, 7);
  }
  assert.equal(report.worker.duplicateClaims, 0);
  assert.equal(report.worker.exits.every((exit: { code: number | null }) => exit.code === 0), true);
  assert.ok(report.productionRouteChunks["/(protected)/items/page"].client.bytes > 0);
  assert.ok(report.applicationWorkloads.xml_parse.records > 0);
  assert.ok(report.applicationWorkloads.export_workbook.records > 0);
  assert.equal(report.collectionOutcomes.inventory_list.rows, 25_000);
  assert.equal(report.collectionOutcomes.inventory_list.batchLimit, 500);
  assert.equal(report.collectionOutcomes.inventory_list.pageCount, 51);
  assert.equal(report.collectionOutcomes.inventory_list.withinLimit, true);
  assert.ok(report.collectionOutcomes.inventory_list.elapsedMs > 0);
  assert.equal(report.collectionOutcomes.export_source.withinLimit, true);
  assert.ok(report.applicationWorkloads.export_workbook.peakGrowthMiB <= 256);
  assert.equal(report.applicationWorkloads.export_workbook.sloMs, 3_000);
  assert.ok(report.applicationWorkloads.export_workbook.p95Ms <= 3_000);
  assert.ok(report.applicationWorkloads.export_workbook.peakBaselineRssMiB > 0);
  assert.equal(report.applicationWorkloads.export_workbook.measurementMode, "isolated_child_process_maxrss");
  assert.equal(report.queries.dockflow_projection.sloMs, 250);
  assert.ok(report.queries.dockflow_projection.p95Ms <= 250);
  assert.ok(report.poolSaturation.p95Ms <= 500);
  assert.equal(report.poolSaturation.errors, 0);
  assert.equal(report.poolSaturation.concurrentScanners, 16);
  assert.equal(report.poolSaturation.poolSize, 8);
  assert.ok(report.poolSaturation.maxWaiting <= 8);
  assert.equal(report.bottlenecks.every((item: { followUp?: string }) => /rollback/i.test(item.followUp ?? "")), true);
  assert.doesNotMatch(raw, /postgres(?:ql)?:\/\/|SESSION_SECRET|VAPID|password/i);

  const scenarios = await captureProductionCapacityScenarios(report.dataset.epoch);
  for (const [name, statements] of Object.entries(scenarios)) {
    const fingerprint = createHash("sha256")
      .update(statements.map((item) => item.sql.replace(/\s+/g, " ").trim()).join("\n-- next statement --\n"))
      .digest("hex");
    assert.equal(report.queries[name].fingerprint, fingerprint, `${name} artifact drift`);
  }

  const followUps: Record<string, string> = {
    pool_saturation: "tech_debt/24-p2-capacity-pool-saturation.md",
    export_memory: "tech_debt/25-p2-capacity-export-memory.md",
    dockflow_projection: "tech_debt/26-p3-capacity-dockflow-projection.md",
    inventory_list: "tech_debt/28-p2-inventory-list-projection.md",
    export_source: "tech_debt/28-p2-inventory-list-projection.md",
  };
  assert.equal(report.bottlenecks.some((item: { id: string }) =>
    item.id === "inventory_list_capacity" || item.id === "export_source_capacity"), false);
  for (const item of report.bottlenecks as Array<{ id: string; budget: number }>) {
    assert.ok(followUps[item.id], `missing follow-up for ${item.id}`);
    const task = await readFile(followUps[item.id]!, "utf8");
    const formattedBudget = String(item.budget).replace(/\B(?=(\d{3})+(?!\d))/g, ",?");
    assert.match(task, new RegExp(formattedBudget));
    assert.match(task, /rollback/i);
  }
});
