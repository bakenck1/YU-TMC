import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";

import { InventoryItemService } from "@/lib/application/services/inventory-item-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";
import { createPostgresInventoryLocationRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-location-repositories";
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
        category: "electrical_equipment",
        roomId,
        barcode: `RESP-${randomUUID()}`,
        responsibleUserId: firstEmployeeId,
      },
      { userId: adminId, role: "admin" },
    );
    expect(created.category).toBe("electrical_equipment");
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

  it("allows an administrator to correct an official number and preserves its history", async () => {
    const adminId = randomUUID();
    const employeeId = randomUUID();
    const otherEmployeeId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    await seedUsers(adminId, employeeId, otherEmployeeId);
    await seedRoom(adminId, buildingId, roomId);
    const service = createService();
    const actor = { userId: adminId, role: "admin" as const };
    const originalNumber = `ERR-${randomUUID()}`;
    const correctedNumber = `FIX-${randomUUID()}`;

    const created = await service.createItem({
      name: "Number correction test item",
      category: "electronics",
      roomId,
      barcode: originalNumber,
    }, actor);
    const corrected = await service.updateProtected(created.id, {
      version: created.version,
      roomId,
      inventoryNumber: correctedNumber,
      status: "active",
    }, actor);

    expect(corrected.inventoryNumber).toBe(correctedNumber);
    const history = await database.query<{
      value: string;
      replaced_at: Date | null;
      reason: string | null;
    }>(
      `select value, replaced_at, reason
         from "yu_inventory"."item_inventory_number_history"
        where item_id = $1
        order by assigned_at, id`,
      [created.id],
    );
    expect(history.rows).toEqual([
      {
        value: correctedNumber,
        replaced_at: null,
        reason: null,
      },
    ]);
    const registry = await database.query<{ original_value: string }>(
      `select original_value from "yu_inventory"."barcode_registry"
        where item_id = $1 and kind = 'official'`,
      [created.id],
    );
    expect(registry.rows).toEqual([{ original_value: correctedNumber }]);

    const correctedAgain = await service.updateProtected(corrected.id, {
      version: corrected.version,
      roomId,
      inventoryNumber: `${correctedNumber}-2`,
      status: "active",
    }, actor);
    expect(correctedAgain.inventoryNumber).toBe(`${correctedNumber}-2`);
    const updatedHistory = await database.query<{
      value: string;
      replaced_at: Date | null;
      reason: string | null;
    }>(
      `select value, replaced_at, reason
         from "yu_inventory"."item_inventory_number_history"
        where item_id = $1
        order by assigned_at, id`,
      [created.id],
    );
    expect(updatedHistory.rows).toHaveLength(2);
    expect(updatedHistory.rows[0]).toMatchObject({
      value: correctedNumber,
      reason: "Исправление номера / штрих-кода ТМЦ",
    });
    expect(updatedHistory.rows[0]!.replaced_at).not.toBeNull();
    expect(updatedHistory.rows[1]).toEqual({
      value: `${correctedNumber}-2`,
      replaced_at: null,
      reason: null,
    });
  });

  it("records decommissioned use without optional evidence and restores the item only through audited actions", async () => {
    const adminId = randomUUID();
    const firstEmployeeId = randomUUID();
    const secondEmployeeId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    await seedUsers(adminId, firstEmployeeId, secondEmployeeId);
    await seedRoom(adminId, buildingId, roomId);
    const service = createService();
    const actor = { userId: adminId, role: "admin" as const };
    const created = await service.createItem({
      name: "Decommissioned projector still in use",
      category: "electrical_equipment",
      roomId,
      responsibleUserId: firstEmployeeId,
    }, actor);
    const inUse = await service.markDecommissionedInUse(created.id, {
      version: created.version,
      roomId,
      responsibleUserId: null,
    }, actor);

    expect(inUse.status).toBe("decommissioned_in_use");
    expect(inUse.responsible).toBeNull();
    expect(inUse.decommissionedUsage).toMatchObject({
      reason: null,
      adminComment: null,
      photoUrl: null,
    });
    await expect(service.getDecommissionedUsagePhoto(created.id, actor)).rejects.toThrow("item_photo_not_found");

    const jpeg = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    }).jpeg().toBuffer();
    const withItemPhoto = await service.updatePhoto(created.id, {
      version: inUse.version,
      imageDataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      width: 2,
      height: 2,
    }, actor);
    expect(withItemPhoto.status).toBe("decommissioned_in_use");
    expect(withItemPhoto.photoUrls).toHaveLength(1);
    await expect(service.getItemPhoto(created.id, actor)).resolves.toMatchObject({
      mimeType: "image/jpeg",
    });

    const withoutItemPhoto = await service.removePhoto(
      created.id,
      withItemPhoto.version,
      actor,
    );
    expect(withoutItemPhoto.photoUrls).toEqual([]);
    await expect(service.updateProtected(created.id, {
      version: withoutItemPhoto.version,
      roomId,
      inventoryNumber: inUse.inventoryNumber,
      status: "active",
    }, actor)).rejects.toThrow("decommissioned_workflow_required");

    const restored = await service.restoreDecommissionedItem(created.id, {
      version: withoutItemPhoto.version,
      reason: "Accounting cancelled the write-off",
    }, actor);
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
    expect(restored.decommissionedUsage).toBeNull();
    const audit = await database.query<{ action: string; reason: string | null }>(
      `select action, after_values->>'reason' as reason
         from "yu_inventory"."audit_records"
        where subject_kind = 'item' and subject_id = $1
          and action in ('item.decommissioned_usage_started', 'item.restored_from_decommission')
        order by occurred_at, id`,
      [created.id],
    );
    expect(audit.rows).toEqual([
      { action: "item.decommissioned_usage_started", reason: null },
      { action: "item.restored_from_decommission", reason: "Accounting cancelled the write-off" },
    ]);
  });

  it("returns the responsible employee name immediately after a room assignment", async () => {
    const adminId = randomUUID();
    const firstEmployeeId = randomUUID();
    const secondEmployeeId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    await seedUsers(adminId, firstEmployeeId, secondEmployeeId);
    await seedRoom(adminId, buildingId, roomId);
    const repository = createPostgresInventoryLocationRepositories(database).locations;

    const updated = await repository.updateRoom({
      id: roomId,
      designation: "Form Room",
      designationKey: `form-${roomId}`,
      floorNumber: 1,
      floorLabel: null,
      primaryResponsibleId: secondEmployeeId,
      actorId: adminId,
      expectedVersion: 1,
      occurredAt: new Date(),
    });

    expect(updated).toMatchObject({
      primaryResponsibleId: secondEmployeeId,
      primaryResponsibleName: "Second Employee",
    });
    await expect(repository.findRoomById(roomId)).resolves.toMatchObject({
      primaryResponsibleId: secondEmployeeId,
      primaryResponsibleName: "Second Employee",
    });
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
