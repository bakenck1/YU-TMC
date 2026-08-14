import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("drizzle/20260810140000_tmc_stage_four.sql", "utf8");
const unassignedMigration = readFileSync(
  "drizzle/20260811045420_mysterious_wind_dancer.sql",
  "utf8",
);
const snapshotConstraintMigration = readFileSync(
  "drizzle/20260811045927_mean_wonder_man.sql",
  "utf8",
);

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

test("stage-four and unassigned-item migrations remain committed in order", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  assert.deepEqual(journal.entries.find((entry) => entry.idx === 18), {
    idx: 18,
    version: "7",
    when: 1786363200000,
    tag: "20260810140000_tmc_stage_four",
    breakpoints: true,
  });
  const unassignedIndex = journal.entries.findIndex(
    (entry) => entry.tag === "20260811045420_mysterious_wind_dancer",
  );
  const snapshotConstraintIndex = journal.entries.findIndex(
    (entry) => entry.tag === "20260811045927_mean_wonder_man",
  );
  assert.equal(snapshotConstraintIndex, unassignedIndex + 1);
});

test("unassigned-item migration only relaxes the two responsibility snapshot columns", () => {
  assert.match(unassignedMigration, /responsibility_period_id_at_request" DROP NOT NULL/);
  assert.match(unassignedMigration, /current_responsible_id_at_request" DROP NOT NULL/);
  assert.doesNotMatch(unassignedMigration, /drop\s+(table|type|column)|alter\s+type/i);
  assert.match(
    snapshotConstraintMigration,
    /tmc_transfer_request_items_responsibility_snapshot_check/,
  );
});
