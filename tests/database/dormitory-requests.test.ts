import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresDormitoryRequestRepository } from "@/lib/server/persistence/postgres/postgres-dormitory-request-repository";
import { createPostgresServiceRequestRepositories } from "@/lib/server/persistence/postgres/postgres-service-request-repositories";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("PostgreSQL dormitory requests", () => {
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

  it("creates one visible request, moves the dormitory item to maintenance, and replays safely", async () => {
    const fixture = await seedDormitoryItem();
    const input = {
      externalRequestId: "dormitory-db-request-1",
      itemId: fixture.itemId,
      action: "repair" as const,
      description: "Repair the bed",
      reporterName: "Dormitory commandant",
    };
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const repository = createPostgresDormitoryRequestRepository(database);

    const created = await repository.create(input, hash);
    expect(created).toMatchObject({ externalRequestId: input.externalRequestId, action: "repair", replayed: false });

    const replay = await repository.create(input, hash);
    expect(replay).toMatchObject({ id: created.id, replayed: true });

    const item = await database.query<{ status: string; condition: string; version: number }>(
      `select status::text, condition::text, version from "yu_inventory"."items" where id = $1`,
      [fixture.itemId],
    );
    expect(item.rows[0]).toMatchObject({ status: "maintenance", condition: "needs_attention", version: 2 });

    const visible = await createPostgresServiceRequestRepositories(database).requests.findById(created.id);
    expect(visible).toMatchObject({
      source: "dormitory",
      externalRequestId: input.externalRequestId,
      requestedAction: "repair",
      authorName: input.reporterName,
    });
    expect(await database.query<{ count: number }>(
      `select count(*)::int count from "yu_inventory"."service_requests" where external_request_id = $1`,
      [input.externalRequestId],
    )).toMatchObject({ rows: [{ count: 1 }] });
  });

  it("rejects an item outside the maintained dormitory list", async () => {
    const fixture = await seedDormitoryItem("Ordinary Building");
    const input = {
      externalRequestId: "dormitory-db-request-outside",
      itemId: fixture.itemId,
      action: "damaged" as const,
      description: "Damage report",
      reporterName: "Commandant",
    };
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await expect(createPostgresDormitoryRequestRepository(database).create(input, hash))
      .rejects.toMatchObject({ publicCode: "dormitory_item_not_found" });
  });
});

async function seedDormitoryItem(buildingName = "Общежитие 3") {
  const actorId = randomUUID();
  const buildingId = randomUUID();
  const roomId = randomUUID();
  const itemId = randomUUID();
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values ($1, $2, $3, 'Database Administrator', 'admin', now(), now())`,
    [actorId, `DR-${actorId.slice(0, 8)}`, `${actorId}@example.com`],
  );
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, $2, $3, 'Test address', $3, $4, $4)`,
    [buildingId, buildingName, `dorm-${buildingId}`, actorId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
     values ($1, $2, '205', $3, 2, $4, $4)`,
    [roomId, buildingId, `room-${roomId}`, actorId],
  );
  await database.query(
    `insert into "yu_inventory"."items"
       (id, name, quantity, unit_price, room_id, inventory_number_kind,
        inventory_number, inventory_number_key, status, condition, created_by, updated_by)
     values ($1, 'Dormitory bed', 1, 50000, $2, 'official', $3::varchar, $3::text,
             'active', 'good', $4, $4)`,
    [itemId, roomId, `DORM-${itemId}`, actorId],
  );
  return { actorId, buildingId, roomId, itemId };
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing unsafe database reset.");
  const resetPool = createPostgresPool(config, { max: 1 });
  try {
    await resetPool.query('drop schema if exists "yu_migrations" cascade');
    await resetPool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await resetPool.end();
  }
}
