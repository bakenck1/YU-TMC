import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";
import { createPostgresQrResolutionRepositories } from "@/lib/server/persistence/postgres/postgres-qr-resolution-repositories";

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

  it("allows only one monitor/system-unit pair and keeps duplicate scans unambiguous", async () => {
    const actorId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    await database.query(
      `insert into yu_inventory.users (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Pair Admin', 'admin', now(), now())`,
      [actorId, `PA-${actorId.slice(0, 8)}`, `${actorId}@example.com`],
    );
    await database.query(
      `insert into yu_inventory.buildings
         (id, name, name_key, address, address_key, created_by, updated_by)
       values ($1, 'Pair Building', $2, 'Pair Address', $2, $3, $3)`,
      [buildingId, `pair-${buildingId}`, actorId],
    );
    await database.query(
      `insert into yu_inventory.rooms
         (id, building_id, designation, designation_key, floor_number, created_by, updated_by)
       values ($1, $2, 'PAIR', $3, 1, $4, $4)`,
      [roomId, buildingId, `pair-${roomId}`, actorId],
    );
    const insert = (id: string, name: string, number: string) => database.query(
      `insert into yu_inventory.items
         (id, name, quantity, unit_price, room_id, inventory_number_kind,
          inventory_number, inventory_number_key, created_by, updated_by)
       values ($1, $2, 1, 1, $3, 'official', $4::varchar, lower($4::text), $5, $5)`,
      [id, name, roomId, number, actorId],
    );

    const monitorId = randomUUID();
    const systemUnitId = randomUUID();
    await insert(monitorId, "Монитор Dell", "PAIR-100");
    await insert(systemUnitId, "Системный блок Dell", "PAIR-100");
    expect((await database.query(
      `select count(*)::int as count from yu_inventory.barcode_registry
        where canonical_key = 'pair-100'`,
    )).rows[0]?.count).toBe(2);

    await expect(insert(randomUUID(), "Моноблок", "PAIR-100"))
      .rejects.toMatchObject({ code: "23505" });
    await expect(insert(randomUUID(), "Монитор HP", "PAIR-100"))
      .rejects.toMatchObject({ code: "23505" });

    const qr = createPostgresQrResolutionRepositories(database).qr;
    expect(await qr.findItemByBarcode("PAIR-100", "pair-100", null)).toBeNull();
    const monitorFallback = monitorId.replaceAll("-", "").slice(0, 16).toUpperCase();
    expect((await qr.findItemByBarcode(`YUI-${monitorFallback}`, "", monitorFallback))?.targetId)
      .toBe(monitorId);

    const raceNumber = `RACE-${randomUUID().slice(0, 8)}`;
    const race = await Promise.allSettled([
      insert(randomUUID(), "Монитор A", raceNumber),
      insert(randomUUID(), "Монитор B", raceNumber),
    ]);
    expect(race.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(race.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const sourceItemId = randomUUID();
    await insert(sourceItemId, "Source item", `SOURCE-${randomUUID().slice(0, 8)}`);
    const crossNamespaceNumber = `CROSS-${randomUUID().slice(0, 8)}`;
    const crossNamespaceRace = await Promise.allSettled([
      insert(randomUUID(), "Ordinary official item", crossNamespaceNumber),
      database.query(
        `insert into yu_inventory.local_item_groups
           (id, item_id, sequence_number, barcode_value, barcode_key, quantity,
            responsible_user_id, room_id, created_by)
         values ($1, $2, nextval('yu_inventory.local_barcode_sequence'), $3::varchar, lower($3::text),
                 1, $4, $5, $4)`,
        [randomUUID(), sourceItemId, crossNamespaceNumber, actorId, roomId],
      ),
    ]);
    expect(crossNamespaceRace.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(crossNamespaceRace.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect((await database.query(
      `select count(*)::int as count from yu_inventory.barcode_registry
        where canonical_key = lower($1)`,
      [crossNamespaceNumber],
    )).rows[0]?.count).toBe(1);
  });

  it("hydrates closed-cabinet scope for scanned items and component history", async () => {
    const adminId = randomUUID();
    const viewerId = randomUUID();
    const componentOwnerId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    const parentItemId = randomUUID();
    const componentItemId = randomUUID();
    await database.query(
      `insert into yu_inventory.users (id, code, email, full_name, role, created_at, updated_at)
       values ($1,$4,$5,'Security Admin','admin',now(),now()),
              ($2,$6,$7,'History Viewer','employee',now(),now()),
              ($3,$8,$9,'Component Owner','employee',now(),now())`,
      [
        adminId,
        viewerId,
        componentOwnerId,
        `SC-${adminId.slice(0, 8)}`,
        `${adminId}@example.com`,
        `SV-${viewerId.slice(0, 8)}`,
        `${viewerId}@example.com`,
        `SO-${componentOwnerId.slice(0, 8)}`,
        `${componentOwnerId}@example.com`,
      ],
    );
    await database.query(
      `insert into yu_inventory.buildings
         (id,name,name_key,address,address_key,created_by,updated_by)
       values ($1,'Security Building',$2,'Security Address',$2,$3,$3)`,
      [buildingId, `security-${buildingId}`, adminId],
    );
    await database.query(
      `insert into yu_inventory.rooms
         (id,building_id,designation,designation_key,floor_number,access_mode,created_by,updated_by)
       values ($1,$2,'SEC',$3,1,'closed',$4,$4)`,
      [roomId, buildingId, `security-${roomId}`, adminId],
    );
    await database.query(
      `insert into yu_inventory.items
         (id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
       values ($1,'Visible parent',1,1,$3,'official',$4,$5,$6,$6),
              ($2,'Hidden component',1,1,$3,'official',$7,$8,$6,$6)`,
      [
        parentItemId,
        componentItemId,
        roomId,
        `SEC-PARENT-${parentItemId.slice(0, 8)}`,
        `sec-parent-${parentItemId.slice(0, 8)}`,
        adminId,
        `SEC-COMPONENT-${componentItemId.slice(0, 8)}`,
        `sec-component-${componentItemId.slice(0, 8)}`,
      ],
    );
    await database.query(
      `insert into yu_inventory.responsibility_periods
         (id,item_id,responsible_user_id,source,started_at,started_by)
       values ($1,$2,$5,'transfer',now(),$7),
              ($3,$4,$6,'transfer',now(),$7)`,
      [
        randomUUID(),
        parentItemId,
        randomUUID(),
        componentItemId,
        viewerId,
        componentOwnerId,
        adminId,
      ],
    );
    await database.query(
      `insert into yu_inventory.audit_records
         (id,actor_id,actor_role_snapshot,subject_kind,subject_id,action,after_values)
       values ($1,$2,'admin','item',$3,'item.component_added',$4::jsonb)`,
      [
        randomUUID(),
        adminId,
        parentItemId,
        JSON.stringify({
          componentId: componentItemId,
          componentName: "Hidden component",
          componentInventoryNumber: `SEC-COMPONENT-${componentItemId.slice(0, 8)}`,
        }),
      ],
    );

    const items = createPostgresInventoryItemRepositories(database).items;
    expect((await items.listOperations(parentItemId))[0]?.componentItem).toEqual({
      id: componentItemId,
      responsibleId: componentOwnerId,
      roomAccessMode: "closed",
      itemSection: "general",
    });

    const scanned = await createPostgresQrResolutionRepositories(database).qr
      .findItemByBarcode(
        `SEC-COMPONENT-${componentItemId.slice(0, 8)}`,
        `sec-component-${componentItemId.slice(0, 8)}`,
        null,
        viewerId,
      );
    expect(scanned).toMatchObject({
      targetId: componentItemId,
      responsibleUserId: componentOwnerId,
      roomAccessMode: "closed",
      currentUserHasRoomItem: false,
    });
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
