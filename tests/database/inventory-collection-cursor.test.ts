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

  it("applies direct, room, and decommissioned assignment scopes before hydration", async () => {
    const actorId = randomUUID();
    const employeeId = randomUUID();
    const buildingId = randomUUID();
    const assignedRoomId = randomUUID();
    const unrelatedRoomId = randomUUID();
    await database.query(
      `insert into yu_inventory.users (id, code, email, full_name, role, created_at, updated_at)
       values ($1,$3,$4,'Scope Admin','admin',now(),now()),
              ($2,$5,$6,'Scoped Employee','employee',now(),now())`,
      [actorId, employeeId, `SA-${actorId.slice(0, 8)}`, `${actorId}@example.com`,
       `SE-${employeeId.slice(0, 8)}`, `${employeeId}@example.com`],
    );
    await database.query(
      `insert into yu_inventory.buildings
         (id,name,name_key,address,address_key,created_by,updated_by)
       values ($1,'Scope Building',$2,'Scope Address',$2,$3,$3)`,
      [buildingId, `scope-${buildingId}`, actorId],
    );
    await database.query(
      `insert into yu_inventory.rooms
         (id,building_id,designation,designation_key,floor_number,primary_responsible_id,created_by,updated_by)
       values ($1,$3,'A',$4,1,$6,$7,$7),($2,$3,'B',$5,1,null,$7,$7)`,
      [assignedRoomId, unrelatedRoomId, buildingId, `scope-${assignedRoomId}`,
       `scope-${unrelatedRoomId}`, employeeId, actorId],
    );
    const directActive = randomUUID();
    const roomActive = randomUUID();
    const unrelatedDecommissioned = randomUUID();
    const directDecommissioned = randomUUID();
    const roomDecommissionedInUse = randomUUID();
    await database.query(
      `insert into yu_inventory.items
         (id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,status,created_by,updated_by)
       values ($1,'Direct active',1,1,$6,'official',$9::varchar,$9::varchar,'active',$8,$8),
              ($2,'Room active',1,1,$7,'official',$10::varchar,$10::varchar,'active',$8,$8),
              ($3,'Unrelated decommissioned',1,1,$6,'official',$11::varchar,$11::varchar,'decommissioned',$8,$8),
              ($4,'Direct decommissioned',1,1,$6,'official',$12::varchar,$12::varchar,'decommissioned',$8,$8),
              ($5,'Room decommissioned',1,1,$7,'official',$13::varchar,$13::varchar,'decommissioned',$8,$8)`,
      [directActive, roomActive, unrelatedDecommissioned, directDecommissioned, roomDecommissionedInUse,
       unrelatedRoomId, assignedRoomId, actorId,
       `scope-${directActive}`, `scope-${roomActive}`, `scope-${unrelatedDecommissioned}`,
       `scope-${directDecommissioned}`, `scope-${roomDecommissionedInUse}`],
    );
    await database.query(
      `update yu_inventory.items
          set updated_at = '2020-01-01T00:00:00Z'
        where id = $1`,
      [directActive],
    );
    await database.query(
      `update yu_inventory.items
          set status = 'decommissioned_in_use', archived_by = $2, archived_at = now(),
              decommissioned_usage_started_at = now(), decommissioned_usage_started_by = $2
        where id = $1`,
      [roomDecommissionedInUse, actorId],
    );
    await database.query(
      `insert into yu_inventory.responsibility_periods
         (id,item_id,responsible_user_id,source,started_at,started_by)
       values ($1,$2,$5,'transfer',now(),$6),($3,$4,$5,'transfer',now(),$6)`,
      [randomUUID(), directActive, randomUUID(), directDecommissioned, employeeId, actorId],
    );

    const repository = createPostgresInventoryItemRepositories(database).items;
    expect(new Set((await repository.listItemsAssignedTo(employeeId)).map((item) => item.id))).toEqual(
      new Set([directActive, roomActive, directDecommissioned, roomDecommissionedInUse]),
    );
    expect(new Set((await repository.listDecommissionedItemsAssignedTo(employeeId)).map((item) => item.id))).toEqual(
      new Set([directDecommissioned, roomDecommissionedInUse]),
    );
    expect((await repository.listDecommissionedItems()).map((item) => item.id)).toContain(unrelatedDecommissioned);
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
