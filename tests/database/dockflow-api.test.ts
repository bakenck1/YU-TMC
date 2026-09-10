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

    const assigned = await repository.itemsForEmployee(ids.iin, { after: null, limit: 10 });
    expect(assigned.map((item) => item.markingType).sort()).toEqual(["batch", "individual"]);
    expect(assigned.every((item) => item.responsible?.iin === ids.iin)).toBe(true);
    expect(await repository.itemsForEmployee("999999999999", { after: null, limit: 10 })).toEqual([]);
    expect((await repository.itemCountsByIin()).get(ids.iin)).toBe(2);

    const inventory = await repository.listItems({ after: null, limit: 10 });
    expect(inventory).toHaveLength(3);
    expect(inventory).toContainEqual(expect.objectContaining({
      id: ids.availableItemId,
      name: "Available",
      barcode: `AVL-${ids.availableItemId}`,
      inventoryNumber: `AVL-${ids.availableItemId}`,
      quantity: 3,
      status: "in_stock",
      availableQuantity: 3,
      storageLocation: "Dockflow Building, 101",
      cost: 300,
      markingType: "individual",
      photoUrl: null,
      responsible: null,
      assignments: [],
    }));
    expect(inventory).toContainEqual(expect.objectContaining({
      id: ids.individualItemId,
      name: "Individual",
      barcode: `IND-${ids.individualItemId}`,
      quantity: 1,
      availableQuantity: 0,
      status: "assigned",
      storageLocation: "Dockflow Building, 101",
      cost: 100,
      markingType: "individual",
      photoUrl: `/api/v1/items/${ids.individualItemId}/photo`,
      responsible: { iin: ids.iin, fullName: "Dockflow Employee" },
      assignments: [expect.objectContaining({ employeeIin: ids.iin, quantity: 1 })],
    }));
    expect(inventory).toContainEqual(expect.objectContaining({
      id: ids.groupId,
      name: "Batch",
      barcode: `BAT-${ids.batchItemId}-0001`,
      inventoryNumber: `BAT-${ids.batchItemId}`,
      quantity: 5,
      availableQuantity: 0,
      status: "assigned",
      storageLocation: "Dockflow Building, 101",
      cost: 200,
      markingType: "batch",
      photoUrl: null,
      responsible: { iin: ids.iin, fullName: "Dockflow Employee" },
      assignments: [expect.objectContaining({ employeeIin: ids.iin, quantity: 5 })],
    }));
    const expectedInventoryIds = inventory.map((item) => item.id);
    const expectedAssignedIds = inventory.filter((item) => item.status === "assigned").map((item) => item.id);

    await migrationPool.query(
      `update "yu_inventory"."responsibility_periods" set started_at = '2026-08-28T10:00:00.123456Z' where item_id = $1`,
      [ids.individualItemId],
    );
    await migrationPool.query(
      `update "yu_inventory"."local_item_groups" set transferred_at = '2026-08-28T10:00:00.123789Z' where item_id = $1`,
      [ids.batchItemId],
    );
    await migrationPool.query(
      `update "yu_inventory"."items"
          set updated_at = case id when $1 then '2026-08-28T10:00:00.123456Z'::timestamptz else '2026-08-28T10:00:00.123789Z'::timestamptz end
        where id in ($1, $2)`,
      [ids.individualItemId, ids.batchItemId],
    );
    await migrationPool.query(
      `update "yu_inventory"."items" set updated_at = '2026-08-27T10:00:00Z'::timestamptz where id = $1`,
      [ids.availableItemId],
    );
    const firstAssignmentPage = await repository.itemsForEmployee(ids.iin, { after: null, limit: 1 });
    const assignmentCursor = firstAssignmentPage[0]!;
    const secondAssignmentPage = await repository.itemsForEmployee(ids.iin, {
      after: { sortValue: assignmentCursor.assignedAt, id: assignmentCursor.id },
      limit: 1,
    });
    expect(new Set([...firstAssignmentPage, ...secondAssignmentPage].map((item) => item.id)).size).toBe(2);
    const inventoryPages = [];
    let after: { sortValue: string; id: string } | null = null;
    for (let page = 0; page < 3; page += 1) {
      const [item] = await repository.listItems({ after, limit: 1 });
      expect(item).toBeDefined();
      inventoryPages.push(item!);
      after = { sortValue: item!.updatedAt, id: item!.id };
    }
    expect(inventoryPages.slice(0, 2).map((item) => item.id)).toEqual(expect.arrayContaining(expectedAssignedIds));
    expect(inventoryPages.map((item) => item.id)).toEqual(expect.arrayContaining(expectedInventoryIds));
    expect(new Set(inventoryPages.map((item) => item.id)).size).toBe(3);
    expect(await repository.listItems({ after, limit: 1 })).toEqual([]);

    await migrationPool.query('update "yu_inventory"."items" set status = \'decommissioned\' where id = $1', [ids.batchItemId]);
    expect((await repository.itemCountsByIin()).get(ids.iin)).toBe(1);

    await migrationPool.query('update "yu_inventory"."users" set is_active = false, deactivated_at = now() where id = $1', [ids.employeeId]);
    expect(await repository.itemsForEmployee(ids.iin, { after: null, limit: 10 })).toEqual([]);
    expect(await repository.listItems({ after: null, limit: 10 })).toEqual([
      expect.objectContaining({ id: ids.availableItemId, status: "in_stock" }),
    ]);
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
  const availableItemId = randomUUID();
  const groupId = randomUUID();
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
     values ($1,'Individual',1,100,$4,'official',$5,$6,$7,$7),
            ($2,'Batch',5,200,$4,'official',$8,$9,$7,$7),
            ($3,'Available',3,300,$4,'official',$10,$11,$7,$7)`,
    [individualItemId, batchItemId, availableItemId, roomId,
     `IND-${individualItemId}`, `ind-${individualItemId}`, adminId,
     `BAT-${batchItemId}`, `bat-${batchItemId}`,
     `AVL-${availableItemId}`, `avl-${availableItemId}`],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."responsibility_periods" (id,item_id,responsible_user_id,source,started_at,started_by)
     values ($1,$2,$3,'transfer',now(),$4)`,
    [randomUUID(), individualItemId, employeeId, adminId],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."photos"
       (id,purpose,status,uploaded_by,original_object_key,preview_object_key,trusted_mime_type,byte_size,width,height,checksum_sha256,
        binary_data,reserved_at,expires_at,attached_at,item_id)
     values ($1,'item','attached',$2,$3,$4,'image/jpeg',1,1,1,$5,decode('ff','hex'),now(),now() + interval '1 hour',now(),$6)`,
    [randomUUID(), adminId, `database://photos/${individualItemId}`, `database://photos/${individualItemId}/preview`, "a".repeat(64), individualItemId],
  );
  await migrationPool.query(
    `insert into "yu_inventory"."local_item_groups" (id,item_id,sequence_number,barcode_value,barcode_key,quantity,responsible_user_id,room_id,previous_room_id,created_by)
     values ($1,$2,1,$3,$4,5,$5,$6,$6,$7)`,
    [groupId, batchItemId, `BAT-${batchItemId}-0001`, `bat-${batchItemId}-0001`, employeeId, roomId, adminId],
  );
  return { employeeId, individualItemId, batchItemId, availableItemId, groupId, iin };
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
