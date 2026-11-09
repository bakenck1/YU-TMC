import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { PATCH } from "@/app/api/inventory/items/[id]/route";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { authenticatedRequest } from "./support/http-request";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("PostgreSQL maintenance resolution", () => {
  beforeAll(async () => {
    resetApplicationServicesForTests();
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 2 });
  });

  afterAll(async () => {
    resetApplicationServicesForTests();
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

      const response = await PATCH(authenticatedRequest(`/api/inventory/items/${itemId}`, { userId: actorId, role: "admin" }, {
        method: "PATCH", body: { operation: "resolve_maintenance", version: 1, status },
      }), { params: Promise.resolve({ id: itemId }) });
      expect(response.status, await response.clone().text()).toBe(200);
      const { item } = await response.json();
      expect(item).toMatchObject({ id: itemId, status, version: 2 });
      const saved = await database.query(
        "select status, archived_by, archived_at, version from yu_inventory.items where id=$1", [itemId],
      );
      expect(saved.rows[0]).toMatchObject({ status, version: 2, archived_by: status === "active" ? null : actorId });
      expect(saved.rows[0].archived_at === null).toBe(status === "active");
      if (status === "decommissioned") expect(saved.rows[0].archived_at).toBeInstanceOf(Date);
      const audit = await database.query(
        "select actor_id,before_values,after_values from yu_inventory.audit_records where subject_id=$1 and action='item.maintenance_resolved'", [itemId],
      );
      expect(audit.rows).toEqual([{ actor_id: actorId, before_values: { status: "maintenance" }, after_values: { status } }]);
    },
  );

  it.each(["employee", "warehouse"] as const)("rejects a formerly privileged user's repair request after demotion to %s", async (role) => {
    const actorId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), itemId = randomUUID();
    await seedMaintenanceItem({ actorId, buildingId, roomId, itemId });
    await database.query("update yu_inventory.users set role=$2 where id=$1", [actorId, role]);
    const response = await PATCH(authenticatedRequest(`/api/inventory/items/${itemId}`, { userId: actorId, role: "admin" }, {
      method: "PATCH", body: { operation: "resolve_maintenance", version: 1, status: "decommissioned" },
    }), { params: Promise.resolve({ id: itemId }) });
    expect(response.status).toBe(403);
    const saved = await database.query("select status, version, archived_by from yu_inventory.items where id=$1", [itemId]);
    expect(saved.rows).toEqual([{ status: "maintenance", version: 1, archived_by: null }]);
  });

  it("rejects resolution after an item has left maintenance without writing an audit", async () => {
    const actorId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), itemId = randomUUID();
    await seedMaintenanceItem({ actorId, buildingId, roomId, itemId });
    await database.query("update yu_inventory.items set status='active' where id=$1", [itemId]);
    const response = await PATCH(authenticatedRequest(`/api/inventory/items/${itemId}`, { userId: actorId, role: "admin" }, {
      method: "PATCH", body: { operation: "resolve_maintenance", version: 1, status: "decommissioned" },
    }), { params: Promise.resolve({ id: itemId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "item_not_in_maintenance" });
    expect((await database.query("select status,version from yu_inventory.items where id=$1", [itemId])).rows).toEqual([{ status: "active", version: 1 }]);
    expect((await database.query("select id from yu_inventory.audit_records where subject_id=$1", [itemId])).rows).toEqual([]);
  });
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
