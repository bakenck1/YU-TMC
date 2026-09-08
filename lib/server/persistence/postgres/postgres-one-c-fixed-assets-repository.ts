import "server-only";

import type { Pool } from "pg";
import { getDatabasePool } from "@/lib/db/client";
import { OneCImportUnavailableError, type OneCFixedAssetRepository } from "@/lib/application/ports/one-c-fixed-assets-repository";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { oneCFixedAssetPayload } from "@/lib/server/integrations/one-c-fixed-assets";

type ImportTimeouts = { statementTimeoutMs: number; transactionTimeoutMs: number };
const DEFAULT_TIMEOUTS: ImportTimeouts = { statementTimeoutMs: 15_000, transactionTimeoutMs: 30_000 };

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

  async saveBatch(assets: readonly OneCFixedAsset[]) {
    const client = await this.pool.connect();
    let transactionStarted = false;
    const result = { created: 0, updated: 0, unchanged: 0 };
    const deadline = Date.now() + this.timeouts.transactionTimeoutMs;
    let destroyClient = false;
    try {
      await client.query("begin");
      transactionStarted = true;
      for (const asset of assets) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error("one_c_import_transaction_timeout");
        await client.query("select set_config('statement_timeout', $1, true)", [
          `${Math.min(this.timeouts.statementTimeoutMs, remainingMs)}ms`,
        ]);
        const { payload, hash } = oneCFixedAssetPayload(asset);
        const stored = await client.query<{ created: boolean }>(
          `insert into "yu_inventory"."one_c_fixed_asset_inbox" as inbox
             (external_id, payload_hash, payload, received_at, updated_at)
           values ($1, $2, $3::jsonb, transaction_timestamp(), transaction_timestamp())
           on conflict (external_id) do update set
             payload_hash = excluded.payload_hash,
             payload = excluded.payload,
             received_at = transaction_timestamp(),
             updated_at = transaction_timestamp()
           where inbox.payload_hash is distinct from excluded.payload_hash
           returning (xmax = 0) as created`,
          [asset.externalId, hash, payload],
        );
        if (!stored.rowCount) result.unchanged += 1;
        else if (stored.rows[0]?.created) result.created += 1;
        else result.updated += 1;
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
