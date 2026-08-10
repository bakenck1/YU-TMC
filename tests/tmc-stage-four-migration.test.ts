import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/20260810140000_tmc_stage_four.sql", "utf8");

test("stage-four migration adds only the required forward-compatible enum values", () => {
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'tmc_transfer\.cancelled'/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'tmc_transfer\.problem'/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'tmc_transfer_request'/);
  assert.doesNotMatch(migration, /drop\s+(table|type|column)/i);
});

test("stage-four migration creates a durable leased Web Push outbox", () => {
  assert.match(migration, /CREATE TABLE "yu_inventory"\."tmc_web_push_outbox"/);
  assert.match(migration, /tmc_web_push_outbox_due_idx/);
  assert.match(migration, /locked_by[\s\S]+locked_until[\s\S]+dead_lettered_at/);
  assert.equal(readFileSync("drizzle/meta/20260810140000_snapshot.json", "utf8").includes("tmc_web_push_outbox"), true);
  assert.equal(readFileSync("drizzle/meta/20260810140000_snapshot.json", "utf8").includes("tmc_web_push_delivery_attempts"), true);
});

test("stage-four migration is the committed journal tail", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  assert.deepEqual(journal.entries.at(-1), {
    idx: 18,
    version: "7",
    when: 1786363200000,
    tag: "20260810140000_tmc_stage_four",
    breakpoints: true,
  });
});
