import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { OneCImportUnavailableError, type OneCFixedAssetRepository, type OneCImportMetadata } from "@/lib/application/ports/one-c-fixed-assets-repository";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { oneCFixedAssetPayload } from "@/lib/server/integrations/one-c-fixed-assets";

type ImportTimeouts = { statementTimeoutMs: number; transactionTimeoutMs: number };
const DEFAULT_TIMEOUTS: ImportTimeouts = { statementTimeoutMs: 120_000, transactionTimeoutMs: 150_000 };

type BatchCountersRow = {
  created: string | number;
  updated: string | number;
  unchanged: string | number;
};

export class PostgresOneCFixedAssetRepository implements OneCFixedAssetRepository {
  constructor(
    private readonly pool: Pick<Pool, "connect"> = getDatabasePool(),
    private readonly timeouts: ImportTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  async tryAcquireLease(keyId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 731004)) as acquired",
        [keyId],
      );
      if (!result.rows[0]?.acquired) { client.release(); return null; }
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          try {
            const unlocked = await client.query<{ unlocked: boolean }>(
              "select pg_advisory_unlock(hashtextextended($1, 731004)) as unlocked", [keyId],
            );
            if (!unlocked.rows[0]?.unlocked) throw new Error("one_c_import_lease_not_held");
            client.release();
          } catch (error) {
            client.release(error instanceof Error ? error : true);
            throw new OneCImportUnavailableError("store_unavailable", { cause: error });
          }
        },
      };
    } catch (error) {
      client.release(error instanceof Error ? error : true);
      throw new OneCImportUnavailableError("store_unavailable", { cause: error });
    }
  }

  async saveBatch(assets: readonly OneCFixedAsset[], metadata?: OneCImportMetadata) {
    const client = await this.pool.connect();
    let transactionStarted = false;
    const result = { created: 0, updated: 0, unchanged: 0 };
    const deadline = Date.now() + this.timeouts.transactionTimeoutMs;
    let destroyClient = false;
    try {
      await client.query("begin");
      transactionStarted = true;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error("one_c_import_transaction_timeout");
      await client.query("select set_config('statement_timeout', $1, true)", [
        `${Math.min(this.timeouts.statementTimeoutMs, remainingMs)}ms`,
      ]);
      const batch = assets.map((asset) => {
        const { hash } = oneCFixedAssetPayload(asset);
        return { external_id: asset.externalId, payload_hash: hash, payload: asset };
      });
      const stored = await client.query<BatchCountersRow>(
        `with incoming as (
           select row.external_id, row.payload_hash, row.payload
             from jsonb_to_recordset($1::jsonb) as row(
               external_id text,
               payload_hash varchar(64),
               payload jsonb
             )
         ), upserted as (
           insert into "yu_inventory"."one_c_fixed_asset_inbox" as inbox
             (external_id, payload_hash, payload, received_at, updated_at)
           select external_id, payload_hash, payload,
                  transaction_timestamp(), transaction_timestamp()
             from incoming
           on conflict (external_id) do update set
             payload_hash = excluded.payload_hash,
             payload = excluded.payload,
             received_at = transaction_timestamp(),
             updated_at = transaction_timestamp()
           where inbox.payload_hash is distinct from excluded.payload_hash
           returning (xmax = 0) as created
         )
         select count(*) filter (where created)::int as created,
                count(*) filter (where not created)::int as updated,
                ($2::int - count(*))::int as unchanged
           from upserted`,
        [JSON.stringify(batch), assets.length],
      );
      const counters = stored.rows[0];
      if (!counters) throw new Error("one_c_import_counters_missing");
      result.created = Number(counters.created);
      result.updated = Number(counters.updated);
      result.unchanged = Number(counters.unchanged);
      if (metadata) {
      const sourceSha256 = metadata.sourceSha256;
      const batchId = randomUUID();
      const insertedBatch = await client.query<{ id: string }>(
        `insert into "yu_inventory"."one_c_import_batches"
          (id, request_id, source_filename, source_sha256, received_count, created_count, updated_count, unchanged_count, summary)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         on conflict (source_sha256) do nothing returning id`,
        [batchId, metadata?.requestId ?? null, metadata?.sourceFilename ?? null, sourceSha256,
          assets.length, result.created, result.updated, result.unchanged,
          JSON.stringify({ snapshotKind: metadata ? "verified_source" : "unverified_legacy_snapshot", automaticPublication: false })],
      );
      const effectiveBatchId = insertedBatch.rows[0]?.id ?? (await client.query<{ id: string }>(
        `select id from "yu_inventory"."one_c_import_batches" where source_sha256 = $1`, [sourceSha256],
      )).rows[0]?.id;
      if (!effectiveBatchId) throw new Error("one_c_import_batch_missing");
      if (insertedBatch.rowCount) {
        await client.query(
          `insert into "yu_inventory"."one_c_import_batch_rows"
             (batch_id, external_id, payload_hash, payload)
           select $1::uuid, row.external_id, row.payload_hash, row.payload
             from jsonb_to_recordset($2::jsonb) as row(external_id text, payload_hash varchar(64), payload jsonb)`,
          [effectiveBatchId, JSON.stringify(batch)],
        );
      }
      await client.query(
        `update "yu_inventory"."one_c_fixed_asset_inbox" set
           last_batch_id = $1, last_request_id = $2, last_seen_at = transaction_timestamp()
         where external_id = any($3::text[])`,
        [effectiveBatchId, metadata?.requestId ?? null, assets.map((asset) => asset.externalId)],
      );
      }
      await client.query("commit");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try { await client.query("rollback"); }
        catch { destroyClient = true; }
      }
      throw new OneCImportUnavailableError(isTimeout(error) ? "import_timeout" : "store_unavailable", { cause: error });
    } finally {
      client.release(destroyClient);
    }
  }
}

function isTimeout(error: unknown) {
  return (typeof error === "object" && error !== null && "code" in error && error.code === "57014")
    || (error instanceof Error && error.message === "one_c_import_transaction_timeout");
}
