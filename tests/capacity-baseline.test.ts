import assert from "node:assert/strict";
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
  for (const [name, statements] of Object.entries(scenarios)) {
    assert.ok(statements.length > 0, name);
    for (const { sql } of statements) {
      const normalized = sql.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim();
      assert.match(normalized, /^(?:select|with)\b/i, name);
      assert.doesNotMatch(normalized, /\b(?:insert|update|delete|merge|truncate|alter|drop|create|copy|call)\b/i, name);
    }
  }
});

test("measurement runner refuses an unspecified database before measuring or writing a report", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/capacity/measure.mjs"], { encoding: "utf8", windowsHide: true, env: { ...process.env, CAPACITY_DATABASE_URL: "", TEST_DATABASE_URL: "" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CAPACITY_DATABASE_URL is required/);
});

test("disposable seed requires an explicit loopback-only capability", async () => {
  const { spawnSync } = await import("node:child_process");
  const attempts = [
    { CAPACITY_ALLOW_DISPOSABLE_SEED: "", TEST_DATABASE_DEPLOYMENT_ID: "capacity-local-review", TEST_DATABASE_MIGRATOR_URL: "postgresql://unused:unused@127.0.0.1/unused", error: /CAPACITY_ALLOW_DISPOSABLE_SEED/ },
    { CAPACITY_ALLOW_DISPOSABLE_SEED: "1", TEST_DATABASE_DEPLOYMENT_ID: "ordinary-database", TEST_DATABASE_MIGRATOR_URL: "postgresql://unused:unused@127.0.0.1/unused", error: /not identified as capacity-local/ },
    { CAPACITY_ALLOW_DISPOSABLE_SEED: "1", TEST_DATABASE_DEPLOYMENT_ID: "capacity-local-review", TEST_DATABASE_MIGRATOR_URL: "postgresql://unused:unused@remote.invalid/unused", error: /loopback/ },
  ];
  for (const { error, ...env } of attempts) {
    const result = spawnSync(process.execPath, ["scripts/capacity/seed-disposable.mjs"], { encoding: "utf8", windowsHide: true, timeout: 5_000, env: { ...process.env, ...env } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
  }
});

test("committed baseline contains complete, credential-free evidence and actionable breaches", async () => {
  const raw = await readFile("docs/capacity-baseline-v1.json", "utf8");
  const report = JSON.parse(raw);
  assert.doesNotMatch(raw, /postgres(?:ql)?:\/\/|SESSION_SECRET|VAPID|password/i);
  for (const query of Object.values(report.queries) as Array<{ plans: unknown[]; samplesMs: number[]; sloMs: number; p95Ms: number }>) {
    assert.ok(query.plans.length > 0);
    assert.ok(query.samplesMs.length > 0);
    assert.ok(Number.isFinite(query.p95Ms));
    assert.ok(query.sloMs > 0);
  }
  assert.equal(report.worker.duplicateClaims, 0);
  assert.equal(report.poolSaturation.errors, 0);
});
