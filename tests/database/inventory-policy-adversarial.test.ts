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

  it("bulk 1C code persists with leading zeroes, reloads in cards and rolls back an incomplete batch", async () => {
    const adminId = randomUUID();
    const roomId = randomUUID();
    await seedUsers(adminId, randomUUID(), randomUUID());
    await seedRoom(adminId, randomUUID(), roomId);
    const actor = { userId: adminId, role: "admin" as const };
    const service = createService(runtimeDatabase);
    const first = await service.createItem({ name: "Coded cable", category: "components", roomId, quantity: 28, unitPrice: 50 }, actor);
    const second = await service.createItem({ name: "Coded component", category: "components", roomId }, actor);
    const unselected = await service.createItem({ name: "Unselected component", category: "components", roomId }, actor);
    const ids = [first.id, second.id];
    expect(await service.bulkChangeOneCCode(ids, " 00000014398 ", actor)).toEqual({
      updatedItemIds: ids, oneCCode: "00000014398",
    });
    for (const id of ids) {
      const reloaded = await service.findItem(id, actor);
      expect(reloaded).toMatchObject({ oneCCode: "00000014398", quantity: id === first.id ? 28 : 1, name: id === first.id ? first.name : second.name });
    }
    expect((await service.findItem(unselected.id, actor)).oneCCode).toBeNull();
    const before = await database.query('select id, one_c_code, version from "yu_inventory"."items" where id = any($1::uuid[]) order by id', [ids]);
    const stale = await createPostgresInventoryItemRepositories(runtimeDatabase).items.updateItemOneCCode({
      id: first.id, oneCCode: "00042", actorId: adminId, expectedVersion: first.version, occurredAt: new Date(),
    });
    expect(stale).toBeNull();
    expect(await service.bulkChangeOneCCode(ids, "00000014398", actor)).toEqual({ updatedItemIds: ids, oneCCode: "00000014398" });
    expect((await database.query('select id, one_c_code, version from "yu_inventory"."items" where id = any($1::uuid[]) order by id', [ids])).rows).toEqual(before.rows);
    await expect(service.bulkChangeOneCCode([first.id, randomUUID()], "00042", actor)).rejects.toThrow("item_not_found");
    const after = await database.query('select id, one_c_code, version from "yu_inventory"."items" where id = any($1::uuid[]) order by id', [ids]);
    expect(after.rows).toEqual(before.rows);
    const audits = await database.query('select before_values, after_values from "yu_inventory"."audit_records" where subject_id = any($1::uuid[]) and action = $2', [ids, "item.one_c_code_updated"]);
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows.every(row => row.after_values.oneCCode === "00000014398")).toBe(true);
  });

  it("bulk project flag persists for all selected items and rolls back a batch with an unavailable item", async () => {
    const adminId = randomUUID();
    const roomId = randomUUID();
    await seedUsers(adminId, randomUUID(), randomUUID());
    await seedRoom(adminId, randomUUID(), roomId);
    const actor = { userId: adminId, role: "admin" as const };
    const service = createService(runtimeDatabase);
    const first = await service.createItem({ name: "Project monitor", category: "components", roomId, responsibleUserId: adminId }, actor);
    const second = await service.createItem({ name: "Project cable", category: "components", roomId, responsibleUserId: adminId }, actor);
    const ids = [first.id, second.id];
    const snapshot = async () => (await database.query(
      `select i.id,i.name,i.is_project,i.version,i.room_id,i.status,i.inventory_number,i.quantity,
        (select responsible_user_id from yu_inventory.responsibility_periods where item_id=i.id and ended_at is null) as responsible_user_id
       from yu_inventory.items i where i.id=any($1::uuid[]) order by i.id`, [ids],
    )).rows;
    const original = await snapshot();
    expect(await service.bulkChangeProject(ids, true, actor)).toEqual(ids);
    const afterMark = await snapshot();
    expect(afterMark).toEqual(original.map(row => ({ ...row, is_project: true, version: row.version + 1 })));
    const firstAudits = await database.query('select before_values,after_values from yu_inventory.audit_records where subject_id=any($1::uuid[]) and action=\'item.project_updated\'', [ids]);
    expect(firstAudits.rows).toEqual([
      { before_values: { isProject: false }, after_values: { isProject: true } },
      { before_values: { isProject: false }, after_values: { isProject: true } },
    ]);
    expect(await service.bulkChangeProject(ids, true, actor)).toEqual(ids);
    expect(await snapshot()).toEqual(afterMark);
    expect((await database.query('select id from yu_inventory.audit_records where subject_id=any($1::uuid[]) and action=\'item.project_updated\'', [ids])).rows).toHaveLength(2);
    const marked = await database.query('select id, is_project, version, room_id, status from "yu_inventory"."items" where id = any($1::uuid[]) order by id', [ids]);
    expect(marked.rows).toHaveLength(2);
    for (const row of marked.rows) {
      expect(row).toMatchObject({ is_project: true, room_id: roomId, status: "active" });
    }
    await expect(service.bulkChangeProject([first.id, randomUUID()], false, actor)).rejects.toThrow("item_not_found");
    const afterFailure = await database.query('select id, is_project, version, room_id, status from "yu_inventory"."items" where id = any($1::uuid[]) order by id', [ids]);
    expect(afterFailure.rows).toEqual(marked.rows);
    expect(await service.bulkChangeProject(ids, false, actor)).toEqual(ids);
    expect(await snapshot()).toEqual(original.map(row => ({ ...row, is_project: false, version: row.version + 2 })));
    const unmarked = await database.query('select is_project from "yu_inventory"."items" where id = any($1::uuid[])', [ids]);
    expect(unmarked.rows.every(row => row.is_project === false)).toBe(true);
    const audits = await database.query('select action from "yu_inventory"."audit_records" where subject_id = any($1::uuid[]) and action = $2', [ids, "item.project_updated"]);
    expect(audits.rows).toHaveLength(4);
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
    const previousNumbers = await database.query('select kind,value,replaced_at,reason from "yu_inventory"."item_inventory_number_history" where item_id = $1', [created.id]);
    expect(previousNumbers.rows).toEqual([expect.objectContaining({ kind: "official", value: created.inventoryNumber, replaced_at: expect.any(Date), reason: expect.any(String) })]);
    expect((await database.query('select * from "yu_inventory"."barcode_registry" where item_id = $1 and kind = $2', [created.id, "official"])).rows).toHaveLength(0);
    expect((await database.query('select * from "yu_inventory"."item_inventory_number_history" where item_id = $1 and value = $2', [created.id, ""])).rows).toHaveLength(0);
  });
  it.each(["official", "temporary"] as const)("preserves the original %s number and its replacement independently of the item name", async (kind) => {
    const adminId = randomUUID(); const roomId = randomUUID();
    await seedUsers(adminId, randomUUID(), randomUUID()); await seedRoom(adminId, randomUUID(), roomId);
    const actor = { userId: adminId, role: "admin" as const }; const service = createService(runtimeDatabase);
    const created = await service.createItem({ name: "Projector", category: "electronics", roomId,
      ...(kind === "official" ? { inventoryNumber: "INV-" + randomUUID() } : {}) }, actor);
    const originalHistory = await database.query('select kind,value,assigned_at,replaced_at from "yu_inventory"."item_inventory_number_history" where item_id=$1', [created.id]);
    expect(originalHistory.rows).toEqual([{ kind, value: created.inventoryNumber, assigned_at: new Date(created.createdAt), replaced_at: null }]);
    const nextNumber = "INV-" + randomUUID();
    const updated = await service.updateProtected(created.id, { version: created.version, roomId, inventoryNumber: nextNumber, status: "active" }, actor);
    await service.updateContent(created.id, { version: updated.version, name: "Renamed projector", category: "electronics" }, actor);
    const history = await database.query('select kind,value,replaced_at,reason from "yu_inventory"."item_inventory_number_history" where item_id=$1 order by assigned_at,id', [created.id]);
    expect(history.rows).toHaveLength(2);
    expect(history.rows).toContainEqual(expect.objectContaining({ kind, value: created.inventoryNumber, replaced_at: expect.any(Date), reason: expect.any(String) }));
    expect(history.rows).toContainEqual({ kind: "official", value: nextNumber, replaced_at: null, reason: null });
    expect((await service.findItem(created.id, actor)).inventoryNumber).toBe(nextNumber);
  });
  it.each(["inventoryNumber", "barcode"] as const)("keeps the submitted %s through creation, renaming, moving and status changes", async (field) => {
    const adminId = randomUUID(); const roomId = randomUUID(); const nextRoomId = randomUUID();
    await seedUsers(adminId, randomUUID(), randomUUID());
    await seedRoom(adminId, randomUUID(), roomId); await seedRoom(adminId, randomUUID(), nextRoomId);
    const actor = { userId: adminId, role: "admin" as const }; const service = createService(runtimeDatabase);
    // Keep the slash and every leading zero, including after scanning Code 39.
    const number = "001/000" + randomBytes(4).readUInt32BE(0);
    const created = await service.createItem({ name: "Projector OPTOMA", category: "electronics", roomId,
      [field]: field === "barcode" ? `*${number}*` : number }, actor);
    expect(created.inventoryNumber).toBe(number); expect(created.inventoryNumberKind).toBe("official");
    const renamed = await service.updateContent(created.id, { version: created.version, name: "Projector", category: "electronics" }, actor);
    const moved = await service.updateProtected(created.id, { version: renamed.version, roomId: nextRoomId, inventoryNumber: renamed.inventoryNumber, status: "active" }, actor);
    const changed = await service.changeStatus(created.id, { version: moved.version, status: "broken" }, actor);
    const reloaded = await service.findItem(created.id, actor);
    expect(changed.inventoryNumber).toBe(number); expect(reloaded.inventoryNumber).toBe(number);
    expect(reloaded.room.id).toBe(nextRoomId);
    expect((await database.query('select kind,value,replaced_at from "yu_inventory"."item_inventory_number_history" where item_id=$1', [created.id])).rows)
      .toEqual([{ kind: "official", value: number, replaced_at: null }]);
    expect((await database.query('select original_value from "yu_inventory"."barcode_registry" where item_id=$1 and kind=$2', [created.id, "official"])).rows)
      .toEqual([{ original_value: number }]);
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
    const rows = await repository.listItems({ limit: 100, after: null });
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
