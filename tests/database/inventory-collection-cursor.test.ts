import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";

let config: DatabaseConfig;
let database: Pool;

describe("PostgreSQL inventory collection cursor", () => {
  beforeAll(async () => {
    config = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(config);
    await migrateDatabase(config);
    database = createPostgresPool(config, { max: 2 });
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(config);
  });

  it("does not skip the 501st row when a page boundary has microsecond precision", async () => {
    const actorId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    await database.query(
      `insert into yu_inventory.users (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Cursor Admin', 'admin', now(), now())`,
      [actorId, `CA-${actorId.slice(0, 8)}`, `${actorId}@example.com`],
    );
    await database.query(
      `insert into yu_inventory.buildings
         (id, name, name_key, address, address_key, created_by, updated_by)
       values ($1, 'Cursor Building', $2, 'Cursor Address', $2, $3, $3)`,
      [buildingId, `cursor-${buildingId}`, actorId],
    );
    await database.query(
      `insert into yu_inventory.rooms
         (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
       values ($1, $2, '501', $3, 5, $4, $4)`,
      [roomId, buildingId, `cursor-${roomId}`, actorId],
    );
    await database.query(
      `insert into yu_inventory.items
         (id, name, quantity, unit_price, room_id, inventory_number_kind,
          inventory_number, inventory_number_key, created_by, updated_by, updated_at)
       select md5('inventory-cursor:' || g)::uuid, 'Cursor Item ' || g, 1, 1, $1,
              'official', 'CUR-' || g, 'cur-' || g, $2, $2,
              '2026-09-09T12:00:00.123456Z'::timestamptz
         from generate_series(1, 501) g`,
      [roomId, actorId],
    );

    const items = await createPostgresInventoryItemRepositories(database).items.listItems();
    expect(items).toHaveLength(501);
    expect(new Set(items.map((item) => item.id)).size).toBe(501);
  });
});

async function resetSchemas(databaseConfig: DatabaseConfig) {
  if (!databaseConfig.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const pool = createPostgresPool(databaseConfig, { max: 1 });
  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await pool.end();
  }
}
