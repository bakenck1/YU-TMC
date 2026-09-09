import { createHash } from "node:crypto";
import type { Pool, QueryResult, QueryResultRow } from "pg";

import { createPostgresAssetLossRepositories } from "../../lib/server/persistence/postgres/postgres-asset-loss-repository";
import { createPostgresDockflowInventoryRepository } from "../../lib/server/persistence/postgres/postgres-dockflow-inventory-repository";
import { createPostgresInventoryItemRepositories } from "../../lib/server/persistence/postgres/postgres-inventory-item-repositories";
import { createPostgresTmcOperationRepositories } from "../../lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import type { PostgresRepositorySource } from "../../lib/server/persistence/postgres/postgres-unit-of-work";
import { COLLECTION_LIMITS } from "../../lib/server/persistence/collection-limits";
export { TMC_PUSH_WORKER_LEASE_MS } from "../../lib/application/services/web-push-service";
export const INVENTORY_COLLECTION_LIMIT = COLLECTION_LIMITS.inventoryItems;

export interface CapacityStatement {
  sql: string;
  values: readonly unknown[];
}

export type CapacityScenarios = Record<string, CapacityStatement[]>;

const ACTOR_ID = deterministicUuid("capacity:user:2");

/**
 * Capture SQL through the real adapters so performance evidence cannot drift
 * into a hand-written approximation of a production collection query.
 */
export async function captureProductionCapacityScenarios(epoch: string): Promise<CapacityScenarios> {
  const inventory = captureSource();
  await createPostgresInventoryItemRepositories(inventory.source).items.listItems();

  const dockflow = capturePool();
  await createPostgresDockflowInventoryRepository(dockflow.pool).listItems();

  const losses = captureSource();
  await createPostgresAssetLossRepositories(losses.source).assetLosses.list({ employeeId: null, before: null, limit: 101 });

  const historyIds = Array.from({ length: 101 }, (_, index) => ({ id: deterministicUuid(`capacity:tmc-request:${index + 1}`) }));
  const history = captureSource((sql) => /^select request\.id from/.test(sql.replace(/\s+/g, " ").trim()) ? historyIds : []);
  const historyRepository = createPostgresTmcOperationRepositories(history.source).stageFour;
  const historyInput = {
    actorId: ACTOR_ID,
    includeAll: true,
    now: new Date(epoch),
    limit: 101,
  } as const;
  await historyRepository.listHistory(historyInput);
  await historyRepository.listLocationHistory(historyInput);

  const notifications = captureSource((sql) => /select count\(\*\)::text as count/.test(sql) ? [{ count: "0" }] : []);
  const notificationRepository = createPostgresTmcOperationRepositories(notifications.source).stageFour;
  await notificationRepository.listNotifications({ actorId: ACTOR_ID, includeAdminQueue: true, now: historyInput.now, limit: 101 });
  await notificationRepository.countUnreadNotifications({ actorId: ACTOR_ID, includeAdminQueue: true, now: historyInput.now });

  return {
    inventory_list: inventory.statements,
    export_source: inventory.statements,
    dockflow_projection: dockflow.statements,
    tmc_history: history.statements,
    tmc_notifications: notifications.statements,
    asset_loss_list: losses.statements,
    worker_due_scan: [{
      sql: `select notification_event_id from yu_inventory.tmc_web_push_outbox
        where processed_at is null and dead_lettered_at is null and available_at <= now()
          and (locked_until is null or locked_until < now())
        order by available_at, notification_event_id limit $1`,
      values: [50],
    }],
  };
}

function captureSource(respond: ((sql: string) => QueryResultRow[]) | QueryResultRow[] = []) {
  const statements: CapacityStatement[] = [];
  const source = {
    query: async <Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []) => {
      statements.push({ sql, values });
      const rows = typeof respond === "function" ? respond(sql) : respond;
      return emptyResult(rows as Row[]);
    },
  } as unknown as PostgresRepositorySource;
  return { source, statements };
}

function capturePool() {
  const statements: CapacityStatement[] = [];
  const pool = {
    query: async <Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []) => {
      statements.push({ sql, values });
      return emptyResult<Row>([]);
    },
  } as unknown as Pool;
  return { pool, statements };
}

function emptyResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}

function deterministicUuid(value: string) {
  const hex = createHash("md5").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
