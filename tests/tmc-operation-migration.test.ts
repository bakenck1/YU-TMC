import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../drizzle/", import.meta.url);
const schemaSource = readFileSync(
  new URL("../lib/db/schema.ts", import.meta.url),
  "utf8",
);

function readTmcOperationsMigration(): string {
  const candidates = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({
      name,
      source: readFileSync(new URL(name, migrationsDirectory), "utf8"),
    }))
    .filter(({ source }) =>
      source.includes(
        'CREATE TABLE "yu_inventory"."tmc_transfer_requests"',
      ),
    );

  assert.equal(
    candidates.length,
    1,
    "expected exactly one forward migration for TMC operation requests",
  );
  return candidates[0].source;
}

test("TMC operations schema exposes additive request entities", () => {
  assert.match(schemaSource, /export const tmcTransferRequestsTable/);
  assert.match(schemaSource, /export const tmcTransferRequestItemsTable/);
  assert.match(schemaSource, /export const tmcOperationNotificationsTable/);
  assert.doesNotMatch(schemaSource, /export const transfersTable\s*=\s*undefined/);
});

test("TMC operations migration creates the request and notification model", () => {
  const migration = readTmcOperationsMigration();

  assert.match(
    migration,
    /CREATE TYPE "yu_inventory"\."tmc_transfer_request_status" AS ENUM\('pending', 'accepted', 'rejected', 'cancelled'\)/,
  );
  assert.match(
    migration,
    /CREATE TYPE "yu_inventory"\."tmc_transfer_item_result" AS ENUM\('pending', 'accepted', 'rejected', 'cancelled', 'invalidated'\)/,
  );
  assert.match(
    migration,
    /ALTER TYPE "yu_inventory"\."notification_event_type" ADD VALUE 'tmc_transfer\.requested'/,
  );
  assert.match(
    migration,
    /ALTER TYPE "yu_inventory"\."notification_event_type" ADD VALUE 'tmc_transfer\.completed'/,
  );
  assert.match(
    migration,
    /ALTER TYPE "yu_inventory"\."notification_event_type" ADD VALUE 'tmc_transfer\.overdue'/,
  );
  assert.match(
    migration,
    /ALTER TYPE "yu_inventory"\."notification_subject_kind" ADD VALUE 'tmc_transfer_request'/,
  );
  assert.match(
    migration,
    /CREATE TABLE "yu_inventory"\."tmc_transfer_request_items"/,
  );
  assert.match(
    migration,
    /CREATE TABLE "yu_inventory"\."tmc_operation_notifications"/,
  );

  assert.match(migration, /tmc_transfer_requests_participants_check/);
  assert.match(migration, /tmc_transfer_requests_state_check/);
  assert.match(migration, /tmc_transfer_requests_time_check/);
  assert.match(migration, /tmc_transfer_request_items_state_check/);
  assert.match(migration, /tmc_transfer_request_items_time_check/);

  assert.match(migration, /tmc_transfer_request_items_request_item_unique/);
  assert.match(migration, /responsibility_periods_tmc_snapshot_unique/);
  assert.match(migration, /tmc_transfer_request_items_period_snapshot_fk/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "tmc_transfer_request_items_pending_item_unique"[^;]+WHERE [^;]+\."result" = 'pending'/,
  );
  assert.match(migration, /tmc_transfer_requests_status_expires_idx/);
  assert.match(migration, /tmc_transfer_requests_recipient_status_created_idx/);
  assert.match(migration, /tmc_transfer_requests_initiator_created_idx/);
  assert.match(migration, /tmc_transfer_request_items_request_result_idx/);
  assert.match(migration, /tmc_operation_notifications_pk/);
  assert.match(
    migration,
    /"notification_event_id" uuid NOT NULL/,
  );
  assert.doesNotMatch(
    migration,
    /"tmc_operation_notifications"[\s\S]*?"read_at"/,
    "generic notification deliveries remain the canonical unread state",
  );
  const notificationTable = migration.match(
    /CREATE TABLE "yu_inventory"\."tmc_operation_notifications" \(([\s\S]*?)\n\);/,
  );
  assert.ok(notificationTable);
  assert.doesNotMatch(
    notificationTable[1],
    /"recipient_id"|"type"/,
    "TMC metadata must not duplicate generic event type or recipient",
  );
  assert.doesNotMatch(
    migration,
    /CREATE TYPE "yu_inventory"\."tmc_operation_notification_type"/,
    "TMC metadata must use the generic event type",
  );
  assert.match(migration, /enforce_tmc_notification_event/);
  assert.match(migration, /WHERE event\.id = NEW\.notification_event_id\s+FOR SHARE/);
  assert.match(migration, /tmc_operation_notifications_event_trigger/);
  assert.match(migration, /protect_tmc_notification_event/);
  assert.match(migration, /notification_events_tmc_consistency_trigger/);
  assert.match(migration, /enforce_single_active_item_transfer/);
  assert.match(migration, /transfers_single_active_item_trigger/);
  assert.match(migration, /tmc_request_items_single_active_item_trigger/);

  const requestForeignKeys = migration.match(
    /tmc_transfer_request_items_[^\s"]+_fk[\s\S]*?ON DELETE restrict ON UPDATE restrict/g,
  );
  assert.ok(
    (requestForeignKeys?.length ?? 0) >= 5,
    "historical request-item references must not cascade",
  );
});

test("TMC migration metadata extends the committed predecessor cleanly", () => {
  const journal = JSON.parse(
    readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: Array<{ idx: number; when: number; tag: string }> };
  const current = journal.entries.at(-1);
  const previous = journal.entries.at(-2);

  assert.equal(current?.tag, "20260808110000_tmc_operation_requests");
  assert.equal(current?.idx, (previous?.idx ?? -1) + 1);
  assert.ok((current?.when ?? 0) > (previous?.when ?? Number.MAX_SAFE_INTEGER));
  for (const entry of journal.entries) {
    assert.equal(
      existsSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url)),
      true,
      `missing SQL for journal entry ${entry.tag}`,
    );
  }

  const snapshot = JSON.parse(
    readFileSync(
      new URL("../drizzle/meta/20260808110000_snapshot.json", import.meta.url),
      "utf8",
    ),
  ) as { prevId: string };
  const previousSnapshot = JSON.parse(
    readFileSync(
      new URL(`../drizzle/meta/${previous?.tag.slice(0, 14)}_snapshot.json`, import.meta.url),
      "utf8",
    ),
  ) as { id: string };
  assert.equal(snapshot.prevId, previousSnapshot.id);
});
