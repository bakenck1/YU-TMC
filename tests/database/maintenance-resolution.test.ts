import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("PostgreSQL maintenance resolution", () => {
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

  it.each(["active", "decommissioned"] as const)(
    "resolves a maintenance item to %s and returns its new state",
    async (status) => {
      const actorId = randomUUID();
      const buildingId = randomUUID();
      const roomId = randomUUID();
      const itemId = randomUUID();
      await seedMaintenanceItem({ actorId, buildingId, roomId, itemId });

      const item = await createPostgresInventoryItemRepositories(database).items
        .resolveMaintenanceItem({
          id: itemId,
          status,
          actorId,
          expectedVersion: 1,
          occurredAt: new Date("2026-08-31T10:00:00.000Z"),
        });

      expect(item).toMatchObject({ id: itemId, status, version: 2 });
      expect(item?.archivedAt === null).toBe(status === "active");
    },
  );
});

async function seedMaintenanceItem(input: {
  actorId: string;
  buildingId: string;
  roomId: string;
  itemId: string;
}) {
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values ($1, $2, $3, 'Maintenance Administrator', 'admin', now(), now())`,
    [input.actorId, `MA-${input.actorId.slice(0, 8)}`, `${input.actorId}@example.com`],
  );
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Maintenance Building', $2, 'Maintenance Address', $2, $3, $3)`,
    [input.buildingId, `maintenance-${input.buildingId}`, input.actorId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Maintenance Room', $3, 1, $4, $4)`,
    [input.roomId, input.buildingId, `maintenance-${input.roomId}`, input.actorId],
  );
  await database.query(
    `insert into "yu_inventory"."items"
       (id, name, quantity, unit_price, room_id, inventory_number_kind,
        inventory_number, inventory_number_key, status, created_by, updated_by)
     values ($1, 'Maintenance Item', 1, 1, $2, 'official', $3, $4,
             'maintenance', $5, $5)`,
    [
      input.itemId,
      input.roomId,
      `MAINT-${input.itemId}`,
      `maint-${input.itemId}`,
      input.actorId,
    ],
  );
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
