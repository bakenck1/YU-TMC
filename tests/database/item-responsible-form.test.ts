import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InventoryItemService } from "@/lib/application/services/inventory-item-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";
import { createPostgresInventoryResponsibilityRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-responsibility-repositories";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("PostgreSQL item-form responsibility assignment", () => {
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

  it("creates and replaces the open responsibility period in the item transaction", async () => {
    const adminId = randomUUID();
    const firstEmployeeId = randomUUID();
    const secondEmployeeId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    await seedUsers(adminId, firstEmployeeId, secondEmployeeId);
    await seedRoom(adminId, buildingId, roomId);
    const service = createService();

    const created = await service.createItem(
      {
        name: "Form-assigned monitor",
        category: "electronics",
        roomId,
        barcode: `RESP-${randomUUID()}`,
        responsibleUserId: firstEmployeeId,
      },
      { userId: adminId, role: "admin" },
    );
    expect(created.responsible?.id).toBe(firstEmployeeId);

    const updated = await service.updateProtected(
      created.id,
      {
        version: created.version,
        roomId,
        inventoryNumber: created.inventoryNumber,
        status: "active",
        responsibleUserId: secondEmployeeId,
      },
      { userId: adminId, role: "admin" },
    );
    expect(updated.responsible?.id).toBe(secondEmployeeId);

    const periods = await database.query<{
      responsible_user_id: string;
      ended_at: Date | null;
      source: string;
    }>(
      `select responsible_user_id, ended_at, source
         from "yu_inventory"."responsibility_periods"
        where item_id = $1
        order by started_at, id`,
      [created.id],
    );
    expect(periods.rows).toHaveLength(2);
    expect(periods.rows[0]).toMatchObject({
      responsible_user_id: firstEmployeeId,
      source: "admin_override",
    });
    expect(periods.rows[0]!.ended_at).not.toBeNull();
    expect(periods.rows[1]).toEqual({
      responsible_user_id: secondEmployeeId,
      ended_at: null,
      source: "admin_override",
    });

    const audits = await database.query<{
      reason: string;
      is_administrative_exception: boolean;
    }>(
      `select reason, is_administrative_exception
         from "yu_inventory"."audit_records"
        where subject_kind = 'responsibility' and subject_id = $1
        order by occurred_at, id`,
      [created.id],
    );
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows.every((audit) =>
      audit.reason === "inventory_item_form_assignment" &&
      audit.is_administrative_exception
    )).toBe(true);
  });
});

function createService() {
  return new InventoryItemService(
    new PostgresUnitOfWork(
      () => database,
      (source) => ({
        ...createPostgresInventoryItemRepositories(source),
        ...createPostgresInventoryResponsibilityRepositories(source),
      }),
    ),
    { now: () => new Date() },
    { create: () => randomUUID() },
    { create: () => randomBytes(16) },
    { next: (year) => `TMP-${year}-${randomUUID()}` },
  );
}

async function seedUsers(
  adminId: string,
  firstEmployeeId: string,
  secondEmployeeId: string,
) {
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values
       ($1, $2, $3, 'Form Administrator', 'admin', now(), now()),
       ($4, $5, $6, 'First Employee', 'employee', now(), now()),
       ($7, $8, $9, 'Second Employee', 'employee', now(), now())`,
    [
      adminId,
      `FA-${adminId.slice(0, 8)}`,
      `${adminId}@example.test`,
      firstEmployeeId,
      `FE-${firstEmployeeId.slice(0, 8)}`,
      `${firstEmployeeId}@example.test`,
      secondEmployeeId,
      `SE-${secondEmployeeId.slice(0, 8)}`,
      `${secondEmployeeId}@example.test`,
    ],
  );
}

async function seedRoom(adminId: string, buildingId: string, roomId: string) {
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Form Building', $2, 'Form Address', $2, $3, $3)`,
    [buildingId, `form-${buildingId}`, adminId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Form Room', $3, 1, $4, $4)`,
    [roomId, buildingId, `form-${roomId}`, adminId],
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
