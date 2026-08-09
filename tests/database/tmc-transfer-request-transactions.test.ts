import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  InsertTmcTransferRequestItemRecord,
  TmcOperationRepositories,
  TmcTransferRequestRepository,
} from "@/lib/application/ports/tmc-operation-repositories";
import { TmcTransferRequestService } from "@/lib/application/services/tmc-transfer-request-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresTmcOperationRepositories } from "@/lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import {
  PostgresUnitOfWork,
  type PostgresRepositorySource,
} from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let database: Pool;

describe("TMC transfer request transactions", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    database = createPostgresPool(migrationConfig, { max: 8 });
  });

  afterAll(async () => {
    await database?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("isolates late item conflicts and rolls back an empty parent", async () => {
    const fixture = await seedFixture(9);
    const actor = { userId: fixture.initiatorId, role: "employee" as const };
    const activeConflictId = fixture.itemIds[1]!;
    const activeConflictService = createService(async (source, input) => {
      if (input.itemId !== activeConflictId) return;
      await source.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [randomUUID(), input.itemId, fixture.recipientIds[0], fixture.initiatorId],
      );
    });

    const partial = await activeConflictService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: fixture.itemIds.slice(0, 3),
    }, actor);
    expect(partial.included).toBe(2);
    expect(partial.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome)).toEqual([
      "included",
      "active_transfer_exists",
      "included",
    ]);
    expect(partial.request?.items).toHaveLength(2);
    await expectPersistedRequest(partial.request!.id, 2);
    const rolledBackLegacy = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."transfers"
        where item_id = $1`,
      [activeConflictId],
    );
    expect(rolledBackLegacy.rows[0]?.count).toBe(0);

    const requestsBefore = await requestCount();
    const allConflictId = fixture.itemIds[3]!;
    const allConflictService = createService(async (source, input) => {
      if (input.itemId !== allConflictId) return;
      await source.query(
        `insert into "yu_inventory"."transfers"
           (id, item_id, requested_by, proposed_responsible_id,
            current_responsible_id_at_request)
         values ($1, $2, $3, $3, $4)`,
        [randomUUID(), input.itemId, fixture.recipientIds[0], fixture.initiatorId],
      );
    });
    const rejected = await allConflictService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [allConflictId],
    }, actor);
    expect(rejected).toMatchObject({ request: null, included: 0, problems: 1 });
    expect(rejected.items[0]).toMatchObject({ problem: "active_transfer_exists" });
    expect(await requestCount()).toBe(requestsBefore);

    const versionConflictId = fixture.itemIds[4]!;
    const versionConflictService = createService(async (source, input) => {
      if (input.itemId !== versionConflictId) return;
      await source.query(
        `update "yu_inventory"."items"
            set version = version + 1, updated_at = now()
          where id = $1`,
        [input.itemId],
      );
    });
    const versionResult = await versionConflictService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [versionConflictId, fixture.itemIds[5]!],
    }, actor);
    expect(versionResult.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome)).toEqual([
      "version_conflict",
      "included",
    ]);
    const unchangedVersion = await database.query<{ version: number }>(
      `select version from "yu_inventory"."items" where id = $1`,
      [versionConflictId],
    );
    expect(unchangedVersion.rows[0]?.version).toBe(1);

    const concurrentItemId = fixture.itemIds[6]!;
    const concurrent = await Promise.all([
      createService().create({
        recipientId: fixture.recipientIds[0]!,
        itemIds: [concurrentItemId],
      }, actor),
      createService().create({
        recipientId: fixture.recipientIds[1]!,
        itemIds: [concurrentItemId],
      }, actor),
    ]);
    expect(concurrent.filter(({ included }) => included === 1)).toHaveLength(1);
    expect(concurrent.filter(({ included }) => included === 0)).toHaveLength(1);
    expect(
      concurrent.flatMap(({ items }) => items).some(
        (item) => item.outcome === "problem" && item.problem === "active_transfer_exists",
      ),
    ).toBe(true);
    const activeRows = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."tmc_transfer_request_items"
        where item_id = $1 and result = 'pending'`,
      [concurrentItemId],
    );
    expect(activeRows.rows[0]?.count).toBe(1);

    const externallyChangedVersionId = fixture.itemIds[7]!;
    const observedVersions: number[] = [];
    let versionChanged = false;
    const externallyChangedVersionService = createService(
      async (_source, input) => {
        if (input.itemId !== externallyChangedVersionId) return;
        observedVersions.push(input.expectedItemVersion);
        if (versionChanged) return;
        versionChanged = true;
        await database.query(
          `update "yu_inventory"."items"
              set version = version + 1, updated_at = now()
            where id = $1`,
          [input.itemId],
        );
      },
    );
    const retriedVersion = await externallyChangedVersionService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [externallyChangedVersionId],
    }, actor);
    expect(observedVersions).toEqual([1, 2]);
    expect(retriedVersion).toMatchObject({ included: 1, problems: 0 });
    await expectPersistedRequest(retriedVersion.request!.id, 1);

    const externallyClosedPeriodItemId = fixture.itemIds[8]!;
    const externallyClosedPeriodId = fixture.periodIds[8]!;
    let periodClosed = false;
    const externallyClosedPeriodService = createService(
      async (_source, input) => {
        if (input.itemId !== externallyClosedPeriodItemId || periodClosed) return;
        periodClosed = true;
        await database.query(
          `update "yu_inventory"."responsibility_periods"
              set ended_at = now(), ended_by = $2,
                  end_reason = 'external responsibility change'
            where id = $1`,
          [externallyClosedPeriodId, fixture.initiatorId],
        );
      },
    );
    const requestsBeforeResponsibilityChange = await requestCount();
    const changedResponsibility = await externallyClosedPeriodService.create({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [externallyClosedPeriodItemId],
    }, actor);
    expect(changedResponsibility).toMatchObject({
      request: null,
      included: 0,
      problems: 1,
    });
    expect(changedResponsibility.items[0]).toMatchObject({
      itemId: externallyClosedPeriodItemId,
      problem: "item_unassigned",
    });
    expect(await requestCount()).toBe(requestsBeforeResponsibilityChange);
  });
});

function createService(
  beforeInsert?: (
    source: PostgresRepositorySource,
    input: InsertTmcTransferRequestItemRecord,
  ) => Promise<void>,
) {
  const unitOfWork = new PostgresUnitOfWork<TmcOperationRepositories>(
    () => database,
    (source) => {
      const repositories = createPostgresTmcOperationRepositories(source);
      return beforeInsert
        ? {
            transferRequests: wrapInsert(
              repositories.transferRequests,
              source,
              beforeInsert,
            ),
          }
        : repositories;
    },
    { retryBaseDelayMs: 1 },
  );
  return new TmcTransferRequestService(
    unitOfWork,
    { now: () => new Date() },
    { create: randomUUID },
  );
}

function wrapInsert(
  repository: TmcTransferRequestRepository,
  source: PostgresRepositorySource,
  beforeInsert: (
    source: PostgresRepositorySource,
    input: InsertTmcTransferRequestItemRecord,
  ) => Promise<void>,
): TmcTransferRequestRepository {
  return {
    findUserById: repository.findUserById.bind(repository),
    findCandidates: repository.findCandidates.bind(repository),
    findById: repository.findById.bind(repository),
    insertRequest: repository.insertRequest.bind(repository),
    async insertRequestItem(input) {
      await beforeInsert(source, input);
      return repository.insertRequestItem(input);
    },
  };
}

async function seedFixture(itemCount: number) {
  const initiatorId = randomUUID();
  const recipientIds = [randomUUID(), randomUUID()];
  const buildingId = randomUUID();
  const roomId = randomUUID();
  await database.query(
    `insert into "yu_inventory"."users"
       (id, code, email, full_name, role, created_at, updated_at)
     values
       ($1, $4, $5, 'Transaction Initiator', 'employee', now(), now()),
       ($2, $6, $7, 'Transaction Recipient A', 'employee', now(), now()),
       ($3, $8, $9, 'Transaction Recipient B', 'employee', now(), now())`,
    [
      initiatorId,
      ...recipientIds,
      `TX-I-${initiatorId.slice(0, 8)}`,
      `${initiatorId}@example.com`,
      `TX-A-${recipientIds[0]!.slice(0, 8)}`,
      `${recipientIds[0]}@example.com`,
      `TX-B-${recipientIds[1]!.slice(0, 8)}`,
      `${recipientIds[1]}@example.com`,
    ],
  );
  await database.query(
    `insert into "yu_inventory"."buildings"
       (id, name, name_key, address, address_key, created_by, updated_by)
     values ($1, 'Transaction Building', $2, 'Transaction Address', $2, $3, $3)`,
    [buildingId, `tx-${buildingId}`, initiatorId],
  );
  await database.query(
    `insert into "yu_inventory"."rooms"
       (id, building_id, designation, designation_key, floor_number,
        created_by, updated_by)
     values ($1, $2, 'Transaction Room', $3, 1, $4, $4)`,
    [roomId, buildingId, `tx-${roomId}`, initiatorId],
  );
  const itemIds: string[] = [];
  const periodIds: string[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const itemId = randomUUID();
    itemIds.push(itemId);
    const periodId = randomUUID();
    periodIds.push(periodId);
    await database.query(
      `insert into "yu_inventory"."items"
         (id, name, room_id, inventory_number_kind, inventory_number,
          inventory_number_key, created_by, updated_by)
       values ($1, $2, $3, 'official', $4, $5, $6, $6)`,
      [
        itemId,
        `Transaction Item ${index + 1}`,
        roomId,
        `TX-ITEM-${itemId}`,
        `tx-item-${itemId}`,
        initiatorId,
      ],
    );
    await database.query(
      `insert into "yu_inventory"."responsibility_periods"
         (id, item_id, responsible_user_id, source, started_by)
       values ($1, $2, $3, 'transfer', $3)`,
      [periodId, itemId, initiatorId],
    );
  }
  return { initiatorId, recipientIds, itemIds, periodIds };
}

async function expectPersistedRequest(requestId: string, itemCount: number) {
  const persisted = await database.query<{ items: number }>(
    `select count(request_item.id)::int as items
       from "yu_inventory"."tmc_transfer_requests" request
       left join "yu_inventory"."tmc_transfer_request_items" request_item
         on request_item.request_id = request.id
      where request.id = $1
      group by request.id`,
    [requestId],
  );
  expect(persisted.rows[0]?.items).toBe(itemCount);
}

async function requestCount() {
  const result = await database.query<{ count: number }>(
    `select count(*)::int as count
       from "yu_inventory"."tmc_transfer_requests"`,
  );
  return result.rows[0]?.count ?? 0;
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
