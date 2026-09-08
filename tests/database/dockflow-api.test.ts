import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresDockflowInventoryRepository } from "@/lib/server/persistence/postgres/postgres-dockflow-inventory-repository";

let migrationConfig: DatabaseConfig;
let migrationPool: Pool;
let runtimePool: Pool;

describe("PostgreSQL Dockflow projection", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    const runtimeConfig = readDatabaseConfig({ purpose: "runtime", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    migrationPool = createPostgresPool(migrationConfig, { max: 2 });
    runtimePool = createPostgresPool(runtimeConfig, { max: 2 });
  });

  afterAll(async () => {
    await runtimePool?.end();
    await migrationPool?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("projects individual and local-group assignments through runtime grants and excludes inactive data", async () => {
    const ids = await seed();
    const repository = createPostgresDockflowInventoryRepository(runtimePool);

    const assigned = await repository.itemsForEmployee(ids.iin, { offset: 0, limit: 10 });
    expect(assigned.map((item) => item.markingType).sort()).toEqual(["batch", "individual"]);
    expect(assigned.every((item) => item.responsible?.iin === ids.iin)).toBe(true);
    expect(await repository.itemsForEmployee("999999999999", { offset: 0, limit: 10 })).toEqual([]);
    expect((await repository.itemCountsByIin()).get(ids.iin)).toBe(2);

    const inventory = await repository.listItems({ offset: 0, limit: 10 });
    expect(inventory).toHaveLength(2);
    expect(inventory.every((item) => item.status === "assigned")).toBe(true);

    await migrationPool.query('update "yu_inventory"."items" set status = \'decommissioned\' where id = $1', [ids.batchItemId]);
    expect((await repository.itemCountsByIin()).get(ids.iin)).toBe(1);

    await migrationPool.query('update "yu_inventory"."users" set is_active = false, deactivated_at = now() where id = $1', [ids.employeeId]);
    expect(await repository.itemsForEmployee(ids.iin, { offset: 0, limit: 10 })).toEqual([]);
    expect(await repository.listItems({ offset: 0, limit: 10 })).toEqual([]);
    expect((await repository.itemCountsByIin()).has(ids.iin)).toBe(false);
  });
});

async function seed() {
  const adminId = randomUUID();
  const employeeId = randomUUID();
  const buildingId = randomUUID();
  const roomId = randomUUID();
  const individualItemId = randomUUID();
  const batchItemId = randomUUID();
  const iin = "900101400000";
  await migrationPool.query(
    `insert into "yu_inventory"."users" (id,code,email,full_name,role,iin,created_at,updated_at)
     values ($1,$3,$4,'Dockflow Admin','admin',null,now(),now()),($2,$5,$6,'Dockflow Employee','employee',$7,now(),now())`,
    [adminId, employeeId, `DA-${adminId.slice(0, 8)}`, `${adminId}@example.com`, `DE-${employeeId.slice(0, 8)}`, `${employeeId}@example.com`, iin],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."buildings" (id,name,name_key,address,address_key,created_by,updated_by)
     values ($1,'Dockflow Building',$2,'Dockflow Address',$2,$3,$3)`,
    [buildingId, `dockflow-${buildingId}`, adminId],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."rooms" (id,building_id,designation,designation_key,floor_number,created_by,updated_by)
     values ($1,$2,'101',$3,1,$4,$4)`,
    [roomId, buildingId, `dockflow-${roomId}`, adminId],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."items" (id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
     values ($1,'Individual',1,100,$3,'official',$4,$5,$6,$6),($2,'Batch',5,200,$3,'official',$7,$8,$6,$6)`,
    [individualItemId, batchItemId, roomId, `IND-${individualItemId}`, `ind-${individualItemId}`, adminId, `BAT-${batchItemId}`, `bat-${batchItemId}`],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."responsibility_periods" (id,item_id,responsible_user_id,source,started_at,started_by)
     values ($1,$2,$3,'transfer',now(),$4)`,
    [randomUUID(), individualItemId, employeeId, adminId],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."local_item_groups" (id,item_id,sequence_number,barcode_value,barcode_key,quantity,responsible_user_id,room_id,previous_room_id,created_by)
     values ($1,$2,1,$3,$4,5,$5,$6,$6,$7)`,
    [randomUUID(), batchItemId, `BAT-${batchItemId}-0001`, `bat-${batchItemId}-0001`, employeeId, roomId, adminId],
  );
  return { employeeId, batchItemId, iin };
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(config, { max: 1 });
  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await pool.end();
  }
}
