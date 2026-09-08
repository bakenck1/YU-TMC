import { randomUUID } from "node:crypto";
import { expect } from "vitest";

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

export let database: Pool;
let migrationConfig: DatabaseConfig;

export async function setupTmcTransferDatabase() {
  migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
  await resetSchemas(migrationConfig);
  await migrateDatabase(migrationConfig);
  database = createPostgresPool(migrationConfig, { max: 8 });
}

export async function teardownTmcTransferDatabase() {
  await database?.end();
  await closeDatabase();
  await resetSchemas(migrationConfig);
}

export function createService(
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
    findByIdForUpdate: repository.findByIdForUpdate.bind(repository),
    findItemPhoto: repository.findItemPhoto.bind(repository),
    decideItem: repository.decideItem.bind(repository),
    closeRequest: repository.closeRequest.bind(repository),
    cancelRequest: repository.cancelRequest.bind(repository),
    insertRequest: repository.insertRequest.bind(repository),
    async insertRequestItem(input) {
      await beforeInsert(source, input);
      return repository.insertRequestItem(input);
    },
  };
}

export async function seedFixture(itemCount: number) {
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

export async function expectPersistedRequest(requestId: string, itemCount: number) {
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

export async function requestCount() {
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
