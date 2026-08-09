import "server-only";

import type { QueryResultRow } from "pg";

import type {
  AdvanceInventoryRecordVersionInput,
  IdempotencyRequestInput,
  IdempotencyRequestRepository,
  IdempotencyReservation,
  IdempotencyResponse,
  InventoryConcurrencyRepositories,
  VersionedInventoryRecordRepository,
} from "@/lib/application/ports/inventory-concurrency-repositories";
import { ApplicationError } from "@/lib/domain/application-error";
import type { PostgresRepositorySource } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

const IDEMPOTENCY = '"yu_inventory"."idempotency_requests"';

const VERSIONED_TABLES = {
  building: '"yu_inventory"."buildings"',
  room: '"yu_inventory"."rooms"',
  item: '"yu_inventory"."items"',
  inspection: '"yu_inventory"."inspections"',
  qr_identifier: '"yu_inventory"."qr_identifiers"',
  transfer: '"yu_inventory"."transfers"',
  deviation_decision: '"yu_inventory"."deviation_decisions"',
  photo: '"yu_inventory"."photos"',
} as const;

interface IdempotencyRow extends QueryResultRow {
  id: string;
  request_hash: string;
  state: "processing" | "completed";
  response_status: number | null;
  response_body: Record<string, unknown> | null;
  resource_id: string | null;
}

export function createPostgresInventoryConcurrencyRepositories(
  source: PostgresRepositorySource,
): InventoryConcurrencyRepositories {
  return {
    idempotency: new PostgresIdempotencyRequestRepository(source),
    versions: new PostgresVersionedInventoryRecordRepository(source),
  };
}

export class PostgresVersionedInventoryRecordRepository
  implements VersionedInventoryRecordRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async advanceVersion(
    input: AdvanceInventoryRecordVersionInput,
  ): Promise<number | null> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new ApplicationError("validation", "invalid_expected_version");
    }
    const table = VERSIONED_TABLES[input.record];
    if (!table) {
      throw new ApplicationError("validation", "invalid_versioned_record");
    }
    const result = await this.source.query<{ version: number } & QueryResultRow>(
      `update ${table}
       set version = version + 1
       where id = $1 and version = $2
       returning version`,
      [input.id, input.expectedVersion],
    );
    return result.rows[0]?.version ?? null;
  }
}

export class PostgresIdempotencyRequestRepository
  implements IdempotencyRequestRepository
{
  constructor(private readonly source: PostgresRepositorySource) {}

  async reserve(input: IdempotencyRequestInput): Promise<IdempotencyReservation> {
    const lock = await this.source.query<{
      acquired: boolean;
    } & QueryResultRow>(
      `select pg_try_advisory_xact_lock(
         hashtextextended($1, 918273645)
       ) as acquired`,
      [JSON.stringify([input.actorId, input.operation, input.key])],
    );
    if (!lock.rows[0]?.acquired) return { kind: "in_progress" };

    const inserted = await this.source.query<{ id: string } & QueryResultRow>(
      `insert into ${IDEMPOTENCY}
         (id, actor_id, operation, idempotency_key, request_hash, expires_at)
       values ($1, $2, $3, $4, $5,
               transaction_timestamp() + ($6 * interval '1 millisecond'))
       on conflict (actor_id, operation, idempotency_key) do update
       set id = excluded.id,
           request_hash = excluded.request_hash,
           state = 'processing',
           response_status = null,
           response_body = null,
           resource_id = null,
           created_at = now(),
           completed_at = null,
           expires_at = excluded.expires_at
       where ${IDEMPOTENCY}.expires_at <= transaction_timestamp()
       returning id`,
      [
        input.id,
        input.actorId,
        input.operation,
        input.key,
        input.requestHash,
        input.expiresInMs,
      ],
    );
    if (inserted.rows[0]) return { kind: "reserved", id: inserted.rows[0].id };

    const existing = await this.source.query<IdempotencyRow>(
      `select id, request_hash, state, response_status, response_body, resource_id
       from ${IDEMPOTENCY}
       where actor_id = $1 and operation = $2 and idempotency_key = $3`,
      [input.actorId, input.operation, input.key],
    );
    const row = existing.rows[0];
    if (!row) throw new Error("Idempotency reservation disappeared unexpectedly.");
    if (row.request_hash !== input.requestHash) return { kind: "key_reused" };
    if (row.state === "processing") return { kind: "in_progress" };
    if (row.response_status === null || row.response_body === null) {
      throw new Error("Completed idempotency request is missing its response.");
    }
    return {
      kind: "replay",
      response: {
        body: row.response_body,
        ...(row.resource_id ? { resourceId: row.resource_id } : {}),
        status: row.response_status,
      },
    };
  }

  async complete(
    id: string,
    response: IdempotencyResponse,
  ): Promise<void> {
    const result = await this.source.query(
      `update ${IDEMPOTENCY}
       set state = 'completed', response_status = $2, response_body = $3,
           resource_id = $4, completed_at = transaction_timestamp(),
           expires_at = case
             when $4::uuid is not null then 'infinity'::timestamptz
             else expires_at
           end
       where id = $1 and state = 'processing'`,
      [id, response.status, response.body, response.resourceId ?? null],
    );
    if ((result.rowCount ?? 0) !== 1) {
      throw new ApplicationError("conflict", "idempotency_request_not_processing");
    }
  }
}
