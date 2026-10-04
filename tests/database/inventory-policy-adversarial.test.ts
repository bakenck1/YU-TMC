import { createPostgresDormitoryAssetRepository, DORMITORY_NAMES } from "@/lib/server/persistence/postgres/postgres-dormitory-asset-repository";
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
let runtimeDatabase: Pool;

describe("PostgreSQL adversarial inventory status and category policy", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 2 });
    runtimeDatabase = createPostgresPool({
      ...migrationConfig,
      applicationName: "yu-inventory-item-form-runtime-test",
      connectionString: migrationConfig.runtimeConnectionString,
      purpose: "runtime",
    }, { max: 2 });
  });

  afterAll(async () => {
    await runtimeDatabase?.end();
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("attack: two components with empty numbers insert and edit without duplicate or registry constraint failure", async () => {
    const adminId = randomUUID(); const employeeId = randomUUID(); const otherId = randomUUID(); const roomId = randomUUID();
    await seedUsers(adminId, employeeId, otherId); await seedRoom(adminId, randomUUID(), roomId);
    const actor = { userId: adminId, role: "admin" as const };
    const service = createService(runtimeDatabase);
    const first = await service.createItem({ name: "Cable first", category: "components", roomId, inventoryNumber: "" }, actor);
    const second = await service.createItem({ name: "Cable second", category: "components", roomId }, actor);
    expect(first.inventoryNumber).toBe(""); expect(second.inventoryNumber).toBe("");
    const edited = await service.updateContent(second.id, { version: second.version, name: "Cable renamed", category: "components" }, actor);
    expect(edited.inventoryNumber).toBe("");
    expect((await database.query('select * from "yu_inventory"."barcode_registry" where canonical_key = $1', [""])).rows).toHaveLength(0);
  });
  it("attack: clearing a component number removes official barcode without persisting blank history", async () => {
    const adminId = randomUUID(); const roomId = randomUUID(); await seedUsers(adminId, randomUUID(), randomUUID()); await seedRoom(adminId, randomUUID(), roomId);
    const actor = { userId: adminId, role: "admin" as const }; const service = createService(runtimeDatabase);
    const created = await service.createItem({ name: "Cable numbered", category: "components", roomId, inventoryNumber: "COMP-" + randomUUID() }, actor);
    const cleared = await service.updateProtected(created.id, { version: created.version, roomId, inventoryNumber: "", status: "active" }, actor);
    expect(cleared.inventoryNumber).toBe("");
    expect((await database.query('select * from "yu_inventory"."barcode_registry" where item_id = $1 and kind = $2', [created.id, "official"])).rows).toHaveLength(0);
    expect((await database.query('select * from "yu_inventory"."item_inventory_number_history" where item_id = $1 and value = $2', [created.id, ""])).rows).toHaveLength(0);
  });
  it("attack: broken status persists and warehouse restoration changes only status", async () => {
    const adminId = randomUUID(); const employeeId = randomUUID(); const otherId = randomUUID(); const roomId = randomUUID(); await seedUsers(adminId, employeeId, otherId); await seedRoom(adminId, randomUUID(), roomId);
    const warehouseId = randomUUID(); await database.query('insert into "yu_inventory"."users" (id, code, email, full_name, role, created_at, updated_at) values ($1, $2, $3, $4, $5, now(), now())', [warehouseId, "W-" + warehouseId.slice(0,8), warehouseId + "@example.test", "Warehouse", "warehouse"]);
    const service = createService(runtimeDatabase); const actor = { userId: adminId, role: "admin" as const };
    const created = await service.createItem({ name: "Broken component", category: "components", roomId, status: "broken", responsibleUserId: employeeId }, actor);
    expect(created.status).toBe("broken");
    await expect(service.changeStatus(created.id, { version: created.version, status: "active" }, { userId: employeeId, role: "employee" })).rejects.toThrow("forbidden");
    const restored = await service.changeStatus(created.id, { version: created.version, status: "active" }, { userId: warehouseId, role: "warehouse" });
    expect(restored.status).toBe("active"); expect(restored.inventoryNumber).toBe(""); expect(restored.responsible).toEqual(created.responsible); expect(restored.room).toEqual(created.room);
  });
  it("attack: dormitory asset SQL projection keeps broken status and empty number", async () => {
    const adminId = randomUUID(); const roomId = randomUUID(); const buildingId = randomUUID(); await seedUsers(adminId, randomUUID(), randomUUID()); await seedRoom(adminId, buildingId, roomId);
    await database.query('update "yu_inventory"."buildings" set name = $1 where id = $2', [DORMITORY_NAMES[0], buildingId]);
    const service = createService(runtimeDatabase);
    const item = await service.createItem({ name: "Dormitory broken component", category: "components", roomId, status: "broken" }, { userId: adminId, role: "admin" });
    const repository = createPostgresDormitoryAssetRepository(runtimeDatabase);
    const rows = await repository.listItems({ limit: 100 });
    const asset = rows.find(row => row.id === item.id);
    expect(asset?.status).toBe("broken"); expect(asset?.inventoryNumber).toBe(""); expect(asset?.category).toBe("components");
  });
});

function createService(source: Pool = database) {
  return new InventoryItemService(
    new PostgresUnitOfWork(
      () => source,
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
