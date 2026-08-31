import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("local barcode database invariants", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 2 });
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("enforces the shared namespace, active quantity bound, append-only history and non-reused sequence", async () => {
    const adminId = randomUUID();
    const ownerId = randomUUID();
    const recipientId = randomUUID();
    const buildingId = randomUUID();
    const ownerRoomId = randomUUID();
    const recipientRoomId = randomUUID();
    const itemId = randomUUID();
    const groupId = randomUUID();

    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values
         ($1, $2, $3, 'Administrator', 'admin', now(), now()),
         ($4, $5, $6, 'Owner', 'employee', now(), now()),
         ($7, $8, $9, 'Recipient', 'employee', now(), now())`,
      [
        adminId,
        `A-${adminId.slice(0, 8)}`,
        `${adminId}@example.com`,
        ownerId,
        `O-${ownerId.slice(0, 8)}`,
        `${ownerId}@example.com`,
        recipientId,
        `R-${recipientId.slice(0, 8)}`,
        `${recipientId}@example.com`,
      ],
    );
    await database.query(
      `insert into "yu_inventory"."buildings"
         (id, name, name_key, address, address_key, created_by, updated_by)
       values ($1, 'Local barcode building', $2, 'Local barcode address', $2, $3, $3)`,
      [buildingId, `local-${buildingId}`, adminId],
    );
    await database.query(
      `insert into "yu_inventory"."rooms"
         (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
       values
         ($1, $2, '101', $3, 1, $5, $5),
         ($4, $2, '202', $6, 2, $5, $5)`,
      [
        ownerRoomId,
        buildingId,
        `owner-${ownerRoomId}`,
        recipientRoomId,
        adminId,
        `recipient-${recipientRoomId}`,
      ],
    );
    await database.query(
      `update "yu_inventory"."users" set default_room_id = $2 where id = $1`,
      [recipientId, recipientRoomId],
    );
    await database.query(
      `insert into "yu_inventory"."items"
         (id, name, quantity, room_id, inventory_number_kind, inventory_number,
          inventory_number_key, created_by, updated_by)
       values ($1, 'Chair', 10, $2, 'official', '1234/5678', '1234/5678', $3, $3)`,
      [itemId, ownerRoomId, adminId],
    );

    const sequence = await database.query<{ value: string }>(
      `select nextval('"yu_inventory"."local_barcode_sequence"')::text as value`,
    );
    expect(sequence.rows[0]?.value).toBe("1");
    await database.query(
      `insert into "yu_inventory"."local_item_groups"
         (id, item_id, sequence_number, barcode_value, barcode_key, quantity,
          responsible_user_id, room_id, previous_responsible_user_id,
          previous_room_id, created_by)
       values ($1, $2, 1, '1234/5678-0001', '1234/5678-0001', 5,
               $3, $4, $5, $6, $5)`,
      [groupId, itemId, recipientId, recipientRoomId, ownerId, ownerRoomId],
    );

    const registry = await database.query<{ kind: string }>(
      `select kind from "yu_inventory"."barcode_registry"
       where canonical_key in ('1234/5678', '1234/5678-0001') order by kind`,
    );
    expect(registry.rows.map((row) => row.kind).sort()).toEqual(["local", "official"]);

    await expect(
      database.query(
        `insert into "yu_inventory"."items"
           (id, name, quantity, room_id, inventory_number_kind, inventory_number,
            inventory_number_key, created_by, updated_by)
         values ($1, 'Collision', 1, $2, 'official', '1234/5678-0001',
                 '1234/5678-0001', $3, $3)`,
        [randomUUID(), ownerRoomId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      database.query(
        `insert into "yu_inventory"."local_item_groups"
           (id, item_id, sequence_number, barcode_value, barcode_key, quantity,
            responsible_user_id, room_id, previous_responsible_user_id,
            previous_room_id, created_by)
         values ($1, $2, 2, '1234/5678-0002', '1234/5678-0002', 6,
                 $3, $4, $5, $6, $5)`,
        [randomUUID(), itemId, recipientId, recipientRoomId, ownerId, ownerRoomId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const eventId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."local_item_group_events"
         (id, group_id, event_type, actor_id, from_responsible_user_id,
          to_responsible_user_id, quantity, room_id)
       values ($1, $2, 'created', $3, $4, $5, 5, $6)`,
      [eventId, groupId, ownerId, ownerId, recipientId, recipientRoomId],
    );
    await expect(
      database.query(
        `update "yu_inventory"."local_item_group_events" set quantity = 4 where id = $1`,
        [eventId],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    await database.query(
      `update "yu_inventory"."local_item_groups"
       set status = 'cancelled', cancelled_by = $2, cancelled_at = now(),
           cancellation_reason = 'Mistake', version = version + 1
       where id = $1`,
      [groupId, adminId],
    );
    const retained = await database.query<{ status: string; kind: string }>(
      `select groups.status, registry.kind
       from "yu_inventory"."local_item_groups" groups
       join "yu_inventory"."barcode_registry" registry
         on registry.local_group_id = groups.id
       where groups.id = $1`,
      [groupId],
    );
    expect(retained.rows[0]).toEqual({ status: "cancelled", kind: "local" });

    const next = await database.query<{ value: string }>(
      `select nextval('"yu_inventory"."local_barcode_sequence"')::text as value`,
    );
    expect(Number(next.rows[0]?.value)).toBeGreaterThan(1);
  });
});

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
