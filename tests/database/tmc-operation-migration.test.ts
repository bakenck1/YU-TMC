import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;
let initiatorId: string;
let recipientId: string;

describe("TMC operation migration", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({
      purpose: "migration",
      target: "test",
    });
    await resetSchemas(migrationConfig);
    await expect(migrateDatabase(migrationConfig)).resolves.toMatchObject({
      target: "test",
    });
    await expect(migrateDatabase(migrationConfig)).resolves.toMatchObject({
      target: "test",
    });

    database = createPostgresPool(migrationConfig, { max: 2 });
    initiatorId = randomUUID();
    recipientId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values
         ($1, 'TMC-INIT', 'tmc-initiator@example.com', 'TMC Initiator',
          'employee', now(), now()),
         ($2, 'TMC-RECIPIENT', 'tmc-recipient@example.com', 'TMC Recipient',
          'employee', now(), now())`,
      [initiatorId, recipientId],
    );
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("enforces request snapshots, terminal states, and one active workflow", async () => {
    const buildingId = randomUUID();
    const roomId = randomUUID();
    const itemId = randomUUID();
    const periodId = randomUUID();
    const requestId = randomUUID();
    const secondRequestId = randomUUID();
    const legacyTransferId = randomUUID();

    await database.query(
      `insert into "yu_inventory"."buildings"
         (id, name, name_key, address, address_key, created_by, updated_by)
       values ($1, 'TMC migration building', $2,
               'TMC migration address', $2, $3, $3)`,
      [buildingId, `tmc-${buildingId}`, initiatorId],
    );
    await database.query(
      `insert into "yu_inventory"."rooms"
         (id, building_id, designation, designation_key, floor_number,
          created_by, updated_by)
       values ($1, $2, 'TMC migration room', $3, 1, $4, $4)`,
      [roomId, buildingId, `tmc-${roomId}`, initiatorId],
    );
    await database.query(
      `insert into "yu_inventory"."items"
         (id, name, room_id, inventory_number_kind, inventory_number,
          inventory_number_key, created_by, updated_by)
       values ($1, 'TMC migration item', $2, 'official', $3, $4, $5, $5)`,
      [itemId, roomId, `TMC-${itemId}`, `tmc-${itemId}`, initiatorId],
    );
    await database.query(
      `insert into "yu_inventory"."responsibility_periods"
         (id, item_id, responsible_user_id, source, started_by)
       values ($1, $2, $3, 'transfer', $3)`,
      [periodId, itemId, initiatorId],
    );
    await database.query(
      `insert into "yu_inventory"."tmc_transfer_requests"
         (id, initiator_id, recipient_id)
       values ($1, $2, $3), ($4, $2, $3)`,
      [requestId, initiatorId, recipientId, secondRequestId],
    );

    const expiry = await database.query<{ seconds: number }>(
      `select extract(epoch from expires_at - created_at)::int as seconds
       from "yu_inventory"."tmc_transfer_requests"
       where id = $1`,
      [requestId],
    );
    expect(expiry.rows[0]?.seconds).toBe(86_400);

    await database.query(
      `insert into "yu_inventory"."transfers"
         (id, item_id, requested_by, proposed_responsible_id,
          current_responsible_id_at_request)
       values ($1, $2, $3, $3, $4)`,
      [legacyTransferId, itemId, recipientId, initiatorId],
    );
    await expect(
      expectPendingInsert(requestId, itemId, periodId),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "tmc_active_item_transfer_unique",
    });
    await database.query(
      `update "yu_inventory"."transfers"
       set status = 'cancelled', closed_at = now(), closed_by = $2,
           version = version + 1
       where id = $1`,
      [legacyTransferId, recipientId],
    );

    const firstRequestItemId = randomUUID();
    await insertPendingItem(
      firstRequestItemId,
      requestId,
      itemId,
      periodId,
      initiatorId,
    );
    await expect(
      expectPendingInsert(secondRequestId, itemId, periodId),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "tmc_transfer_request_items_pending_item_unique",
    });
    await expect(
      database.query(
        `update "yu_inventory"."tmc_transfer_request_items"
         set result = 'accepted' where id = $1`,
        [firstRequestItemId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "tmc_transfer_request_items_state_check",
    });

    await database.query(
      `update "yu_inventory"."tmc_transfer_request_items"
       set result = 'accepted', decided_at = now(), decided_by = $2,
           version = version + 1
       where id = $1`,
      [firstRequestItemId, recipientId],
    );
    await expect(
      insertPendingItem(
        randomUUID(),
        secondRequestId,
        itemId,
        periodId,
        recipientId,
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "tmc_transfer_request_items_period_snapshot_fk",
    });
    await expectPendingInsert(secondRequestId, itemId, periodId);
    await database.query(
      `update "yu_inventory"."tmc_transfer_requests"
       set status = 'accepted', closed_at = now(), closed_by = $2,
           version = version + 1
       where id = $1`,
      [requestId, recipientId],
    );
    await expect(
      database.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [randomUUID(), itemId, recipientId, initiatorId],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "tmc_active_item_transfer_unique",
    });
    await expect(
      database.query(
        `delete from "yu_inventory"."tmc_transfer_requests" where id = $1`,
        [requestId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    await database.query(
      `update "yu_inventory"."tmc_transfer_request_items"
       set result = 'rejected', decided_at = now(), decided_by = $2,
           version = version + 1
       where request_id = $1`,
      [secondRequestId, recipientId],
    );
    await database.query(
      `update "yu_inventory"."tmc_transfer_requests"
       set status = 'rejected', closed_at = now(), closed_by = $2,
           version = version + 1
       where id = $1`,
      [secondRequestId, recipientId],
    );
    const concurrentRequestId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."tmc_transfer_requests"
         (id, initiator_id, recipient_id)
       values ($1, $2, $3)`,
      [concurrentRequestId, initiatorId, recipientId],
    );
    const race = await Promise.allSettled([
      database.query(
        `with inserted as (
           insert into "yu_inventory"."transfers"
             (id, item_id, requested_by, proposed_responsible_id,
              current_responsible_id_at_request)
           values ($1, $2, $3, $3, $4)
           returning 1
         )
         select pg_sleep(0.2) from inserted`,
        [randomUUID(), itemId, recipientId, initiatorId],
      ),
      database.query(
        `with inserted as (
           insert into "yu_inventory"."tmc_transfer_request_items"
             (id, request_id, item_id, responsibility_period_id_at_request,
              current_responsible_id_at_request)
           values ($1, $2, $3, $4, $5)
           returning 1
         )
         select pg_sleep(0.2) from inserted`,
        [randomUUID(), concurrentRequestId, itemId, periodId, initiatorId],
      ),
    ]);
    expect(race.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejectedRace = race.find(({ status }) => status === "rejected");
    expect(rejectedRace).toMatchObject({
      status: "rejected",
      reason: {
        code: "23505",
        constraint: "tmc_active_item_transfer_unique",
      },
    });

    await verifyCanonicalNotification(requestId, itemId);
  });
});

async function expectPendingInsert(
  requestId: string,
  itemId: string,
  periodId: string,
) {
  return insertPendingItem(
    randomUUID(),
    requestId,
    itemId,
    periodId,
    initiatorId,
  );
}

async function insertPendingItem(
  id: string,
  requestId: string,
  itemId: string,
  periodId: string,
  responsibleId: string,
) {
  return database.query(
    `insert into "yu_inventory"."tmc_transfer_request_items"
       (id, request_id, item_id, responsibility_period_id_at_request,
        current_responsible_id_at_request)
     values ($1, $2, $3, $4, $5)`,
    [id, requestId, itemId, periodId, responsibleId],
  );
}

async function verifyCanonicalNotification(requestId: string, itemId: string) {
  const eventId = randomUUID();
  await database.query(
    `insert into "yu_inventory"."notification_events"
       (id, domain_event_id, type, actor_id, subject_kind, subject_id,
        subject_revision, audience_kind, safe_payload, occurred_at)
     values ($1, $2, 'tmc_transfer.requested', $3,
             'tmc_transfer_request', $4, 1, 'direct_user', '{}'::jsonb, now())`,
    [eventId, randomUUID(), initiatorId, requestId],
  );
  await database.query(
    `insert into "yu_inventory"."tmc_operation_notifications"
       (notification_event_id, request_id, item_id)
     values ($1, $2, $3)`,
    [eventId, requestId, itemId],
  );
  await database.query(
    `insert into "yu_inventory"."notification_deliveries"
       (event_id, recipient_id, mailbox_sequence)
     values ($1, $2, 1)`,
    [eventId, recipientId],
  );
  await database.query(
    `update "yu_inventory"."notification_deliveries"
     set read_at = now()
     where event_id = $1 and recipient_id = $2`,
    [eventId, recipientId],
  );
  const delivery = await database.query<{ read: boolean }>(
    `select read_at is not null as read
     from "yu_inventory"."notification_deliveries"
     where event_id = $1 and recipient_id = $2`,
    [eventId, recipientId],
  );
  expect(delivery.rows[0]?.read).toBe(true);

  await expect(
    database.query(
      `update "yu_inventory"."notification_events"
       set subject_id = $2
       where id = $1`,
      [eventId, randomUUID()],
    ),
  ).rejects.toMatchObject({
    code: "23514",
    constraint: "tmc_operation_notifications_event_check",
  });
  await expect(
    database.query(
      `update "yu_inventory"."notification_events"
       set type = 'inspection.confirmed'
       where id = $1`,
      [eventId],
    ),
  ).rejects.toMatchObject({
    code: "23514",
    constraint: "tmc_operation_notifications_event_check",
  });

  const wrongEventId = randomUUID();
  await database.query(
    `insert into "yu_inventory"."notification_events"
       (id, domain_event_id, type, actor_id, subject_kind, subject_id,
        subject_revision, audience_kind, safe_payload, occurred_at)
     values ($1, $2, 'inspection.confirmed', $3,
             'inspection', $4, 1, 'direct_user', '{}'::jsonb, now())`,
    [wrongEventId, randomUUID(), initiatorId, requestId],
  );
  await expect(
    database.query(
      `insert into "yu_inventory"."tmc_operation_notifications"
         (notification_event_id, request_id)
       values ($1, $2)`,
      [wrongEventId, requestId],
    ),
  ).rejects.toMatchObject({
    code: "23514",
    constraint: "tmc_operation_notifications_event_check",
  });
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const resetPool = createPostgresPool(config, { max: 1 });
  try {
    await resetPool.query('drop schema if exists "yu_migrations" cascade');
    await resetPool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await resetPool.end();
  }
}
