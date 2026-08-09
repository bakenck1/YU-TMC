import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresWebPushRepositories } from "@/lib/server/persistence/postgres/postgres-web-push-repositories";
import type { Pool } from "pg";

let config: DatabaseConfig;
let database: Pool;

describe("PostgreSQL web push subscriptions", () => {
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

  it("returns active subscriptions for admin, warehouse, and employee only", async () => {
    const users = await Promise.all([
      seedUser("admin", true, false),
      seedUser("warehouse", true, false),
      seedUser("employee", true, false),
      seedUser("employee", false, false),
      seedUser("employee", true, true),
    ]);
    for (const [index, userId] of users.entries()) await seedSubscription(userId, index);
    const subscriptions = createPostgresWebPushRepositories(database).webPushSubscriptions;
    await expect(subscriptions.listByUser(users[0]!)).resolves.toHaveLength(1);
    await expect(subscriptions.listByUser(users[1]!)).resolves.toHaveLength(1);
    await expect(subscriptions.listByUser(users[2]!)).resolves.toHaveLength(1);
    await expect(subscriptions.listByUser(users[3]!)).resolves.toHaveLength(0);
    await expect(subscriptions.listByUser(users[4]!)).resolves.toHaveLength(0);
  });
});

async function seedUser(role: "admin" | "warehouse" | "employee", active: boolean, deleted: boolean) {
  const id = randomUUID();
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, is_active, deactivated_at, deleted_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [id, `P-${id.slice(0, 8)}`, `${id}@example.test`, `Push ${role}`, role, active, active ? null : new Date(), deleted ? new Date() : null],
  );
  return id;
}

async function seedSubscription(userId: string, index: number) {
  await database.query(
    `insert into "yu_inventory"."web_push_subscriptions"
       (id, user_id, endpoint, p256dh, auth, language)
     values ($1, $2, $3, $4, $5, 'ru')`,
    [randomUUID(), userId, `https://fcm.googleapis.com/subscription/pg-${index}`, "P".repeat(65), "A".repeat(22)],
  );
}

async function resetSchemas(databaseConfig: DatabaseConfig) {
  if (!databaseConfig.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const resetPool = createPostgresPool(databaseConfig, { max: 1 });
  try {
    await resetPool.query('drop schema if exists "yu_migrations" cascade');
    await resetPool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await resetPool.end();
  }
}
