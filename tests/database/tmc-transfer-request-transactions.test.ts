import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  IdempotencyRequestRepository,
  IdempotencyResponse,
} from "@/lib/application/ports/inventory-concurrency-repositories";
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
      problem: "forbidden",
    });
    expect(await requestCount()).toBe(requestsBeforeResponsibilityChange);
  });

  it("enforces employee ownership and the administrator override in PostgreSQL", async () => {
    const fixture = await seedFixture(5);
    const foreignOwnerId = fixture.recipientIds[0]!;

    await database.query(
      `update "yu_inventory"."users" set role = 'warehouse' where id = $1`,
      [fixture.initiatorId],
    );
    const warehouseResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[0]!],
    }, { userId: fixture.initiatorId, role: "warehouse" });
    expect(warehouseResult).toMatchObject({ included: 1, problems: 0 });
    await database.query(
      `update "yu_inventory"."users" set role = 'employee' where id = $1`,
      [fixture.initiatorId],
    );

    for (const index of [2, 3]) {
      await database.query(
        `update "yu_inventory"."responsibility_periods"
            set ended_at = now(), ended_by = $2,
                end_reason = 'permission fixture owner change'
          where id = $1`,
        [fixture.periodIds[index], fixture.initiatorId],
      );
      const replacementPeriodId = randomUUID();
      fixture.periodIds[index] = replacementPeriodId;
      await database.query(
        `insert into "yu_inventory"."responsibility_periods"
           (id, item_id, responsible_user_id, source, started_by)
         values ($1, $2, $3, 'transfer', $3)`,
        [replacementPeriodId, fixture.itemIds[index], foreignOwnerId],
      );
    }

    const employeeResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[1]!, fixture.itemIds[2]!],
    }, { userId: fixture.initiatorId, role: "employee" });
    expect(employeeResult.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome)).toEqual([
      "included",
      "forbidden",
    ]);

    const requestsBeforeForbiddenBatch = await requestCount();
    const forbiddenResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[3]!],
    }, { userId: fixture.initiatorId, role: "employee" });
    expect(forbiddenResult).toMatchObject({
      request: null,
      included: 0,
      problems: 1,
    });
    expect(forbiddenResult.items[0]).toMatchObject({ problem: "forbidden" });
    expect(await requestCount()).toBe(requestsBeforeForbiddenBatch);

    const requestsBeforeStaleAdmin = await requestCount();
    const staleAdminResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[3]!],
    }, { userId: fixture.initiatorId, role: "admin" });
    expect(staleAdminResult.items[0]).toMatchObject({ problem: "forbidden" });
    expect(await requestCount()).toBe(requestsBeforeStaleAdmin);

    await database.query(
      `update "yu_inventory"."users"
          set is_active = false, deactivated_at = now(),
              version = version + 1, updated_at = now()
        where id = $1`,
      [fixture.initiatorId],
    );
    await expect(createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[4]!],
    }, { userId: fixture.initiatorId, role: "employee" })).rejects.toMatchObject({
      kind: "forbidden",
      publicCode: "forbidden",
    });

    const adminId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Transaction Administrator', 'admin', now(), now())`,
      [adminId, `TX-ADMIN-${adminId.slice(0, 8)}`, `${adminId}@example.com`],
    );
    const adminResult = await createService().create({
      recipientId: fixture.recipientIds[1]!,
      itemIds: [fixture.itemIds[2]!],
    }, { userId: adminId, role: "admin" });
    expect(adminResult).toMatchObject({ included: 1, problems: 0 });
    expect(adminResult.request).toMatchObject({
      status: "accepted",
      isAdministrativeDecision: true,
      summary: { accepted: 1, pending: 0 },
    });

    const administrativeAssignment = await database.query<{
      responsible_user_id: string;
      source: string;
    }>(
      `select responsible_user_id, source
         from "yu_inventory"."responsibility_periods"
        where item_id = $1 and ended_at is null`,
      [fixture.itemIds[2]],
    );
    expect(administrativeAssignment.rows).toEqual([{
      responsible_user_id: fixture.recipientIds[1],
      source: "admin_override",
    }]);
    const recipientNotification = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."notification_events" event
         join "yu_inventory"."tmc_operation_notifications" notification
           on notification.notification_event_id = event.id
         join "yu_inventory"."notification_deliveries" delivery
           on delivery.event_id = event.id
        where notification.request_id = $1
          and event.type = 'tmc_transfer.completed'
          and delivery.recipient_id = $2`,
      [adminResult.request!.id, fixture.recipientIds[1]],
    );
    expect(recipientNotification.rows[0]?.count).toBe(1);

    const snapshots = await database.query<{
      item_id: string;
      current_responsible_id_at_request: string;
    }>(
      `select item_id, current_responsible_id_at_request
         from "yu_inventory"."tmc_transfer_request_items"
        where request_id = any($1::uuid[])
        order by item_id`,
      [[
        warehouseResult.request!.id,
        employeeResult.request!.id,
        adminResult.request!.id,
      ]],
    );
    expect(new Map(snapshots.rows.map((row) => [
      row.item_id,
      row.current_responsible_id_at_request,
    ]))).toEqual(new Map([
      [fixture.itemIds[0]!, fixture.initiatorId],
      [fixture.itemIds[1]!, fixture.initiatorId],
      [fixture.itemIds[2]!, foreignOwnerId],
    ]));
  });

  it("replays TMC create idempotently across PostgreSQL connections", async () => {
    const fixture = await seedFixture(6);
    const actor = { userId: fixture.initiatorId, role: "employee" as const };
    const requestsBefore = await requestCount();

    const first = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!.toUpperCase(),
      itemIds: [fixture.itemIds[0]!.toUpperCase()],
      comment: "  Ａ idempotent transfer  ",
    }, { ...actor, userId: actor.userId.toUpperCase() }, "tmc-db-replay-001");
    const replay = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[0]!],
      comment: "A idempotent transfer",
    }, actor, "tmc-db-replay-001");
    expect(first.kind).toBe("completed");
    expect(replay).toEqual({ ...first, kind: "replayed" });
    expect(await requestCount()).toBe(requestsBefore + 1);

    const noResource = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [randomUUID()],
    }, actor, "tmc-db-no-resource-1");
    const retention = await database.query<{
      idempotency_key: string;
      is_infinite: boolean;
      resource_id: string | null;
    }>(
      `select idempotency_key,
              expires_at = 'infinity'::timestamptz as is_infinite,
              resource_id
         from "yu_inventory"."idempotency_requests"
        where actor_id = $1
          and operation = 'tmc.transfer_request.create'
          and idempotency_key = any($2::text[])
        order by idempotency_key`,
      [fixture.initiatorId, ["tmc-db-no-resource-1", "tmc-db-replay-001"]],
    );
    expect(noResource).toMatchObject({
      kind: "completed",
      result: { request: null, included: 0, problems: 1 },
      status: 200,
    });
    expect(retention.rows).toEqual([
      {
        idempotency_key: "tmc-db-no-resource-1",
        is_infinite: false,
        resource_id: null,
      },
      {
        idempotency_key: "tmc-db-replay-001",
        is_infinite: true,
        resource_id: first.resourceId,
      },
    ]);

    await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[1]!, fixture.itemIds[2]!],
    }, actor, "tmc-db-mismatch-01");
    await expect(createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[2]!, fixture.itemIds[1]!],
    }, actor, "tmc-db-mismatch-01")).rejects.toMatchObject({
      kind: "conflict",
      publicCode: "idempotency_key_reused",
    });

    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstConcurrent = createService(async (_source, input) => {
      if (input.itemId !== fixture.itemIds[3]) return;
      enterFirst();
      await firstReleased;
    }).createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[3]!],
    }, actor, "tmc-db-concurrent-1");
    await firstEntered;
    await expect(
      createService().createIdempotent({
        recipientId: fixture.recipientIds[0]!,
        itemIds: [fixture.itemIds[3]!],
      }, actor, "tmc-db-concurrent-1"),
    ).rejects.toMatchObject({
      kind: "conflict",
      publicCode: "idempotency_request_in_progress",
    });
    releaseFirst();
    const completedConcurrent = await firstConcurrent;
    const replayedConcurrent = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[3]!],
    }, actor, "tmc-db-concurrent-1");
    expect(completedConcurrent.kind).toBe("completed");
    expect(replayedConcurrent).toEqual({
      ...completedConcurrent,
      kind: "replayed",
    });

    let failCompletion = true;
    const faulty = createService(undefined, async () => {
      if (!failCompletion) return;
      failCompletion = false;
      throw new Error("injected_idempotency_completion_failure");
    });
    const requestsBeforeFailure = await requestCount();
    await expect(faulty.createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[4]!],
    }, actor, "tmc-db-rollback-001")).rejects.toThrow(
      "injected_idempotency_completion_failure",
    );
    expect(await requestCount()).toBe(requestsBeforeFailure);
    const rolledBackReservation = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."idempotency_requests"
        where actor_id = $1 and operation = 'tmc.transfer_request.create'
          and idempotency_key = 'tmc-db-rollback-001'`,
      [fixture.initiatorId],
    );
    expect(rolledBackReservation.rows[0]?.count).toBe(0);
    const retry = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[4]!],
    }, actor, "tmc-db-rollback-001");
    expect(retry.kind).toBe("completed");

    const adminId = randomUUID();
    await database.query(
      `insert into "yu_inventory"."users"
         (id, code, email, full_name, role, created_at, updated_at)
       values ($1, $2, $3, 'Idempotency Administrator', 'admin', now(), now())`,
      [adminId, `IDEM-ADMIN-${adminId.slice(0, 8)}`, `${adminId}@example.com`],
    );
    const independentActor = await createService().createIdempotent({
      recipientId: fixture.recipientIds[0]!,
      itemIds: [fixture.itemIds[5]!],
    }, { userId: adminId, role: "admin" }, "tmc-db-replay-001");
    expect(independentActor.kind).toBe("completed");
    const scopedRows = await database.query<{ count: number }>(
      `select count(*)::int as count
         from "yu_inventory"."idempotency_requests"
        where operation = 'tmc.transfer_request.create'
          and idempotency_key = 'tmc-db-replay-001'`,
    );
    expect(scopedRows.rows[0]?.count).toBe(2);
  });
});

function createService(
  beforeInsert?: (
    source: PostgresRepositorySource,
    input: InsertTmcTransferRequestItemRecord,
  ) => Promise<void>,
  afterComplete?: (
    id: string,
    response: IdempotencyResponse,
  ) => Promise<void>,
) {
  const unitOfWork = new PostgresUnitOfWork<TmcOperationRepositories>(
    () => database,
    (source) => {
      const repositories = createPostgresTmcOperationRepositories(source);
      return {
        ...repositories,
        ...(afterComplete
          ? {
              idempotency: wrapIdempotency(
                repositories.idempotency,
                afterComplete,
              ),
            }
          : {}),
        ...(beforeInsert
          ? {
              transferRequests: wrapInsert(
                repositories.transferRequests,
                source,
                beforeInsert,
              ),
            }
          : {}),
      };
    },
    { retryBaseDelayMs: 1 },
  );
  return new TmcTransferRequestService(
    unitOfWork,
    { now: () => new Date() },
    { create: randomUUID },
  );
}

function wrapIdempotency(
  repository: IdempotencyRequestRepository,
  afterComplete: (
    id: string,
    response: IdempotencyResponse,
  ) => Promise<void>,
): IdempotencyRequestRepository {
  return {
    reserve: repository.reserve.bind(repository),
    async complete(id, response) {
      await repository.complete(id, response);
      await afterComplete(id, response);
    },
  };
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
