import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryResponsibilityRepositories } from "@/lib/application/ports/inventory-responsibility-repositories";
import { InventoryResponsibilityService } from "@/lib/application/services/inventory-responsibility-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresInventoryResponsibilityRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-responsibility-repositories";
import {
  PostgresUnitOfWork,
  type PostgresRepositorySource,
} from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("PostgreSQL inventory transfer override security", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 4 });
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("commits only a transfer-bound live-admin assignment and its audit", async () => {
    const fixture = await seedFixture();
    const result = await createService().overrideTransfer(
      fixture.transferId,
      {
        version: 1,
        reason: "  Emergency compliance assignment  ",
        outcome: "assigned",
        responsibleUserId: fixture.targetId,
      },
      { userId: fixture.adminId, role: "admin", sessionVersion: 1 },
    );

    expect(result).toMatchObject({
      id: fixture.transferId,
      itemId: fixture.itemId,
      status: "overridden",
      version: 2,
    });
    const transfer = await database.query<{
      status: string;
      closed_by: string;
      administrative_reason: string;
      override_outcome: string;
      override_responsible_id: string;
      version: number;
    }>(
      `select status, closed_by, administrative_reason, override_outcome,
              override_responsible_id, version
         from "yu_inventory"."transfers"
        where id = $1`,
      [fixture.transferId],
    );
    expect(transfer.rows).toEqual([{
      status: "overridden",
      closed_by: fixture.adminId,
      administrative_reason: "Emergency compliance assignment",
      override_outcome: "assigned",
      override_responsible_id: fixture.targetId,
      version: 2,
    }]);
    const periods = await database.query<{
      id: string;
      responsible_user_id: string;
      ended_at: Date | null;
      ended_by: string | null;
      source: string;
    }>(
      `select id, responsible_user_id, ended_at, ended_by, source
         from "yu_inventory"."responsibility_periods"
        where item_id = $1
        order by started_at, id`,
      [fixture.itemId],
    );
    expect(periods.rows).toHaveLength(2);
    expect(periods.rows[0]).toMatchObject({
      id: fixture.periodId,
      responsible_user_id: fixture.ownerId,
      ended_by: fixture.adminId,
      source: "transfer",
    });
    expect(periods.rows[0]!.ended_at).not.toBeNull();
    expect(periods.rows[1]).toMatchObject({
      responsible_user_id: fixture.targetId,
      ended_at: null,
      ended_by: null,
      source: "admin_override",
    });
    const audit = await database.query<{
      actor_id: string;
      subject_id: string;
      subject_revision: number;
      reason: string;
      is_administrative_exception: boolean;
    }>(
      `select actor_id, subject_id, subject_revision, reason,
              is_administrative_exception
         from "yu_inventory"."audit_records"
        where subject_kind = 'transfer' and subject_id = $1`,
      [fixture.transferId],
    );
    expect(audit.rows).toEqual([{
      actor_id: fixture.adminId,
      subject_id: fixture.transferId,
      subject_revision: 2,
      reason: "Emergency compliance assignment",
      is_administrative_exception: true,
    }]);
  });

  it("rejects a stale transfer whose open responsibility belongs to a sibling owner", async () => {
    const fixture = await seedFixture({ responsibilityOwner: "alternate" });

    await expect(createService().overrideTransfer(
      fixture.transferId,
      { version: 1, reason: "Stale release", outcome: "released" },
      { userId: fixture.adminId, role: "admin", sessionVersion: 1 },
    )).rejects.toMatchObject({
      kind: "conflict",
      publicCode: "responsibility_changed",
    });

    await expectPendingAndUnaudited(fixture.transferId, fixture.itemId);
    const period = await database.query<{ responsible_user_id: string }>(
      `select responsible_user_id
         from "yu_inventory"."responsibility_periods"
        where item_id = $1 and ended_at is null`,
      [fixture.itemId],
    );
    expect(period.rows).toEqual([{ responsible_user_id: fixture.alternateOwnerId }]);
  });

  it("SQL CAS rejects spoofed/revoked admins and an inactive assignment target", async () => {
    const fixture = await seedFixture();
    const repository = createPostgresInventoryResponsibilityRepositories(
      database,
    ).responsibility;
    const input = {
      id: fixture.transferId,
      expectedItemId: fixture.itemId,
      expectedResponsibilityPeriodId: fixture.periodId,
      expectedCurrentResponsibleId: fixture.ownerId,
      version: 1,
      administratorId: fixture.ownerId,
      administratorSessionVersion: 1,
      closedAt: new Date("2026-08-13T08:00:00.000Z"),
      administrativeReason: "Emergency assignment",
      overrideOutcome: "assigned" as const,
      overrideResponsibleId: fixture.targetId,
    };

    await expect(repository.overrideTransfer(input)).resolves.toBeNull();
    await expect(repository.overrideTransfer({
      ...input,
      administratorId: fixture.adminId,
      administratorSessionVersion: 2,
    })).resolves.toBeNull();
    await database.query(
      `update "yu_inventory"."users"
          set is_active = false, deactivated_at = now()
        where id = $1`,
      [fixture.adminId],
    );
    await expect(repository.overrideTransfer({
      ...input,
      administratorId: fixture.adminId,
    })).resolves.toBeNull();
    await database.query(
      `update "yu_inventory"."users"
          set is_active = true, deactivated_at = null
        where id = $1`,
      [fixture.adminId],
    );
    await database.query(
      `update "yu_inventory"."users"
          set is_active = false, deactivated_at = now()
        where id = $1`,
      [fixture.targetId],
    );
    await expect(repository.overrideTransfer({
      ...input,
      administratorId: fixture.adminId,
    })).resolves.toBeNull();

    await expectPendingAndUnaudited(fixture.transferId, fixture.itemId);
  });

  it("rolls back the transfer update when the responsibility close CAS loses", async () => {
    const fixture = await seedFixture();
    const service = createService((source) => {
      const repositories = createPostgresInventoryResponsibilityRepositories(source);
      const responsibility = new Proxy(repositories.responsibility, {
        get(target, property) {
          if (property === "closeResponsibility") return async () => false;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return { responsibility };
    });

    await expect(service.overrideTransfer(
      fixture.transferId,
      { version: 1, reason: "Emergency release", outcome: "released" },
      { userId: fixture.adminId, role: "admin", sessionVersion: 1 },
    )).rejects.toMatchObject({
      kind: "conflict",
      publicCode: "responsibility_changed",
    });

    await expectPendingAndUnaudited(fixture.transferId, fixture.itemId);
  });
});

function createService(
  repositories: (
    source: PostgresRepositorySource,
  ) => InventoryResponsibilityRepositories =
    createPostgresInventoryResponsibilityRepositories,
) {
  return new InventoryResponsibilityService(
    new PostgresUnitOfWork<InventoryResponsibilityRepositories>(
      () => database,
      repositories,
    ),
    { now: () => new Date("2026-08-13T08:00:00.000Z") },
    { create: () => randomUUID() },
  );
}

async function seedFixture(options: { responsibilityOwner?: "owner" | "alternate" } = {}) {
  const fixture = {
    adminId: randomUUID(),
    ownerId: randomUUID(),
    alternateOwnerId: randomUUID(),
    targetId: randomUUID(),
    buildingId: randomUUID(),
    roomId: randomUUID(),
    itemId: randomUUID(),
    periodId: randomUUID(),
    transferId: randomUUID(),
  };
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values
       ($1, $5, $6, 'Override Administrator', 'admin', now(), now()),
       ($2, $7, $8, 'Snapshot Owner', 'employee', now(), now()),
       ($3, $9, $10, 'Sibling Owner', 'employee', now(), now()),
       ($4, $11, $12, 'Assignment Target', 'employee', now(), now())`,
    [
      fixture.adminId,
      fixture.ownerId,
      fixture.alternateOwnerId,
      fixture.targetId,
      `OA-${fixture.adminId.slice(0, 8)}`,
      `${fixture.adminId}@example.com`,
      `OO-${fixture.ownerId.slice(0, 8)}`,
      `${fixture.ownerId}@example.com`,
      `OS-${fixture.alternateOwnerId.slice(0, 8)}`,
      `${fixture.alternateOwnerId}@example.com`,
      `OT-${fixture.targetId.slice(0, 8)}`,
      `${fixture.targetId}@example.com`,
    ],
  );
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Override Building', $2, 'Override Address', $2, $3, $3)`,
    [fixture.buildingId, `override-${fixture.buildingId}`, fixture.adminId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Override Room', $3, 1, $4, $4)`,
    [fixture.roomId, fixture.buildingId, `override-${fixture.roomId}`, fixture.adminId],
  );
  await database.query(
    `insert into "yu_inventory"."items"
       (id, name, quantity, unit_price, room_id, inventory_number_kind,
        inventory_number, inventory_number_key, created_by, updated_by)
     values ($1, 'Override Item', 1, 1, $2, 'official', $3, $4, $5, $5)`,
    [
      fixture.itemId,
      fixture.roomId,
      `OVERRIDE-${fixture.itemId}`,
      `override-${fixture.itemId}`,
      fixture.adminId,
    ],
  );
  const responsibilityOwnerId =
    options.responsibilityOwner === "alternate"
      ? fixture.alternateOwnerId
      : fixture.ownerId;
  await database.query(
    `insert into "yu_inventory"."responsibility_periods"
       (id, item_id, responsible_user_id, source, started_at, started_by)
     values ($1, $2, $3, 'transfer', '2026-08-01T00:00:00Z', $3)`,
    [fixture.periodId, fixture.itemId, responsibilityOwnerId],
  );
  await database.query(
    `insert into "yu_inventory"."transfers"
       (id, item_id, requested_by, proposed_responsible_id,
        current_responsible_id_at_request)
     values ($1, $2, $3, $3, $4)`,
    [fixture.transferId, fixture.itemId, fixture.targetId, fixture.ownerId],
  );
  return fixture;
}

async function expectPendingAndUnaudited(transferId: string, itemId: string) {
  const transfer = await database.query<{ status: string; version: number }>(
    `select status, version
       from "yu_inventory"."transfers"
      where id = $1`,
    [transferId],
  );
  expect(transfer.rows).toEqual([{ status: "pending_current_owner", version: 1 }]);
  const period = await database.query<{ count: number }>(
    `select count(*)::int as count
       from "yu_inventory"."responsibility_periods"
      where item_id = $1 and ended_at is null`,
    [itemId],
  );
  expect(period.rows).toEqual([{ count: 1 }]);
  const audit = await database.query<{ count: number }>(
    `select count(*)::int as count
       from "yu_inventory"."audit_records"
      where subject_kind = 'transfer' and subject_id = $1`,
    [transferId],
  );
  expect(audit.rows).toEqual([{ count: 0 }]);
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
