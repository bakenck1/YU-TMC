import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TmcOperationRepositoryConflictError } from "@/lib/application/ports/tmc-operation-repositories";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresTmcOperationRepositories } from "@/lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("PostgreSQL TMC operation repositories", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 3 });
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("persists, projects, detects conflicts, and rolls back through real SQL", async () => {
    const initiatorId = randomUUID();
    const recipientId = randomUUID();
    const buildingId = randomUUID();
    const roomId = randomUUID();
    const itemIds = [randomUUID(), randomUUID(), randomUUID()];
    const periodIds = [randomUUID(), randomUUID(), randomUUID()];
    const requestId = randomUUID();
    const conflictRequestId = randomUUID();
    const createdAt = new Date("2026-08-09T12:00:00.000Z");
    const repositories = createPostgresTmcOperationRepositories(database);
    const requests = repositories.transferRequests;

    await seedUsers(initiatorId, recipientId);
    await seedLocation(buildingId, roomId, initiatorId);
    for (let index = 0; index < itemIds.length; index += 1) {
      await seedItemAndResponsibility({
        itemId: itemIds[index]!,
        periodId: periodIds[index]!,
        roomId,
        responsibleId: initiatorId,
        ordinal: index + 1,
      });
    }
    await seedAttachedPhoto(itemIds[0]!, initiatorId);

    await database.query(
      `insert into "yu_inventory"."transfers"
         (id, item_id, requested_by, proposed_responsible_id,
          current_responsible_id_at_request)
       values ($1, $2, $3, $3, $4)`,
      [randomUUID(), itemIds[1], recipientId, initiatorId],
    );

    expect(await requests.findUserById(recipientId)).toMatchObject({
      id: recipientId,
      active: true,
      deletedAt: null,
    });
    expect(await requests.findUserById(randomUUID())).toBeNull();

    await requests.insertRequest({
      id: requestId,
      initiatorId,
      recipientId,
      comment: "Передача оборудования",
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 86_400_000),
    });
    const insertedItem = await requests.insertRequestItem({
      id: randomUUID(),
      requestId,
      itemId: itemIds[0]!,
      responsibilityPeriodIdAtRequest: periodIds[0]!,
      currentResponsibleIdAtRequest: initiatorId,
      createdAt,
    });
    expect(insertedItem).toMatchObject({
      requestId,
      itemId: itemIds[0],
      result: "pending",
      version: 1,
    });

    const candidates = await requests.findCandidates(itemIds);
    expect(candidates).toHaveLength(3);
    const candidatesById = new Map(
      candidates.map((candidate) => [candidate.itemId, candidate]),
    );
    expect(candidatesById.get(itemIds[0]!)?.hasActiveTransfer).toBe(true);
    expect(candidatesById.get(itemIds[1]!)?.hasActiveTransfer).toBe(true);
    expect(candidatesById.get(itemIds[2]!)?.hasActiveTransfer).toBe(false);
    expect(candidatesById.get(itemIds[0]!)).toMatchObject({
      itemId: itemIds[0],
      quantity: 2,
      unitPrice: 125000.5,
      responsibilityPeriodId: periodIds[0],
      responsibleUser: { id: initiatorId, active: true },
      photoUrl: `/api/inventory/items/${itemIds[0]}/photo?v=1`,
    });

    const initialAggregate = await requests.findById(requestId);
    expect(initialAggregate).toMatchObject({
      id: requestId,
      status: "pending",
      comment: "Передача оборудования",
      items: [{
        id: insertedItem.id,
        itemId: itemIds[0],
        responsibilityPeriodIdAtRequest: periodIds[0],
        currentResponsibleIdAtRequest: initiatorId,
        responsibleUserProfile: { fullName: "Repository Initiator" },
        item: { name: "Repository Item 1", roomId },
      }],
    });

    await database.query(
      `update "yu_inventory"."users"
          set full_name = 'Renamed Initiator', updated_at = now()
        where id = $1`,
      [initiatorId],
    );
    await database.query(
      `update "yu_inventory"."items"
          set name = 'Renamed Item', version = version + 1, updated_at = now()
        where id = $1`,
      [itemIds[0]],
    );
    const refreshedAggregate = await requests.findById(requestId);
    expect(refreshedAggregate?.items[0]).toMatchObject({
      responsibilityPeriodIdAtRequest: periodIds[0],
      currentResponsibleIdAtRequest: initiatorId,
      responsibleUserProfile: { fullName: "Renamed Initiator" },
      item: { name: "Renamed Item", version: 2 },
    });

    await requests.insertRequest({
      id: conflictRequestId,
      initiatorId,
      recipientId,
      comment: null,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 86_400_000),
    });
    await expectRepositoryProblem(
      requests.insertRequestItem({
        id: randomUUID(),
        requestId: conflictRequestId,
        itemId: itemIds[0]!,
        responsibilityPeriodIdAtRequest: periodIds[0]!,
        currentResponsibleIdAtRequest: initiatorId,
        createdAt,
      }),
      "active_transfer_exists",
    );
    await expectRepositoryProblem(
      requests.insertRequestItem({
        id: randomUUID(),
        requestId: conflictRequestId,
        itemId: itemIds[1]!,
        responsibilityPeriodIdAtRequest: periodIds[1]!,
        currentResponsibleIdAtRequest: initiatorId,
        createdAt,
      }),
      "active_transfer_exists",
    );
    await expectRepositoryProblem(
      requests.insertRequestItem({
        id: randomUUID(),
        requestId: conflictRequestId,
        itemId: itemIds[2]!,
        responsibilityPeriodIdAtRequest: periodIds[2]!,
        currentResponsibleIdAtRequest: recipientId,
        createdAt,
      }),
      "responsibility_changed",
    );

    const rolledBackRequestId = randomUUID();
    const client = await database.connect();
    try {
      await client.query("begin");
      const transactionalRequests = createPostgresTmcOperationRepositories(client)
        .transferRequests;
      await transactionalRequests.insertRequest({
        id: rolledBackRequestId,
        initiatorId,
        recipientId,
        comment: null,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 86_400_000),
      });
      await transactionalRequests.insertRequestItem({
        id: randomUUID(),
        requestId: rolledBackRequestId,
        itemId: itemIds[2]!,
        responsibilityPeriodIdAtRequest: periodIds[2]!,
        currentResponsibleIdAtRequest: initiatorId,
        createdAt,
      });
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(await requests.findById(rolledBackRequestId)).toBeNull();
  });
});

async function seedUsers(initiatorId: string, recipientId: string) {
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values
       ($1, 'REPO-INIT', 'repository-initiator@example.com',
        'Repository Initiator', 'employee', now(), now()),
       ($2, 'REPO-RECIPIENT', 'repository-recipient@example.com',
        'Repository Recipient', 'employee', now(), now())`,
    [initiatorId, recipientId],
  );
}

async function seedLocation(
  buildingId: string,
  roomId: string,
  actorId: string,
) {
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Repository Building', $2,
             'Repository Address', $2, $3, $3)`,
    [buildingId, `repository-${buildingId}`, actorId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Repository Room', $3, 1, $4, $4)`,
    [roomId, buildingId, `repository-${roomId}`, actorId],
  );
}

async function seedItemAndResponsibility(input: {
  itemId: string;
  periodId: string;
  roomId: string;
  responsibleId: string;
  ordinal: number;
}) {
  await database.query(
    `insert into "yu_inventory"."items"
       (id, name, quantity, unit_price, room_id, inventory_number_kind,
        inventory_number, inventory_number_key, created_by, updated_by)
     values ($1, $2, 2, 125000.50, $3, 'official', $4, $5, $6, $6)`,
    [
      input.itemId,
      `Repository Item ${input.ordinal}`,
      input.roomId,
      `REPO-${input.ordinal}-${input.itemId}`,
      `repo-${input.itemId}`,
      input.responsibleId,
    ],
  );
  await database.query(
    `insert into "yu_inventory"."responsibility_periods"
       (id, item_id, responsible_user_id, source, started_by)
     values ($1, $2, $3, 'transfer', $3)`,
    [input.periodId, input.itemId, input.responsibleId],
  );
}

async function seedAttachedPhoto(itemId: string, uploadedBy: string) {
  await database.query(
    `insert into "yu_inventory"."photos"
       (id, purpose, status, uploaded_by, original_object_key,
        preview_object_key, trusted_mime_type, byte_size, width, height,
        checksum_sha256, reserved_at, expires_at, attached_at, item_id)
     values ($1, 'item', 'attached', $2, $3, $4, 'image/jpeg',
             1, 1, 1, $5, now(), now() + interval '1 hour', now(), $6)`,
    [
      randomUUID(),
      uploadedBy,
      `repository/original/${itemId}`,
      `repository/preview/${itemId}`,
      "0".repeat(64),
      itemId,
    ],
  );
}

async function expectRepositoryProblem(
  promise: Promise<unknown>,
  problem: TmcOperationRepositoryConflictError["problem"],
) {
  try {
    await promise;
    throw new Error(`Expected repository problem: ${problem}`);
  } catch (error) {
    expect(error).toBeInstanceOf(TmcOperationRepositoryConflictError);
    expect(error).toMatchObject({ problem });
  }
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
