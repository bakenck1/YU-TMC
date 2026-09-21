import { createHash, randomUUID } from "node:crypto";
import {
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import { closeDatabase, getDatabasePool } from "@/lib/db/client";

async function main() {
  const target = parseTargetArgument(process.argv.slice(2));
  loadTargetEnvironment(target);

  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    const inbox = await client.query<{
      external_id: string;
      payload_hash: string;
      payload: Record<string, unknown>;
    }>(
      `select external_id, payload_hash, payload
       from "yu_inventory"."one_c_fixed_asset_inbox"
       order by external_id`,
    );

    if (!inbox.rowCount) {
      await client.query("commit");
      console.log(
        JSON.stringify({
          target,
          batchId: null,
          rows: 0,
          verified: false,
          massPublicationBlocked: true,
          status: "empty_inbox",
        }),
      );
      return;
    }

    const sourceSha256 = createHash("sha256")
      .update(
        inbox.rows
          .map((row) => `${row.external_id}:${row.payload_hash}`)
          .join("\n"),
      )
      .digest("hex");
    const id = randomUUID();
    const inserted = await client.query<{ id: string }>(
      `insert into "yu_inventory"."one_c_import_batches"
         (id, source_filename, source_sha256, received_count, created_count, updated_count, unchanged_count, summary)
       values ($1, null, $2, $3, 0, 0, $3, $4::jsonb)
       on conflict (source_sha256) do nothing
       returning id`,
      [
        id,
        sourceSha256,
        inbox.rowCount,
        JSON.stringify({
          snapshotKind: "unverified_legacy_snapshot",
          automaticPublication: false,
          massPublicationBlocked: true,
        }),
      ],
    );
    const batchId = inserted.rows[0]?.id;

    if (batchId) {
      await client.query(
        `insert into "yu_inventory"."one_c_import_batch_rows"
           (batch_id, external_id, payload_hash, payload)
         select $1, external_id, payload_hash, payload
         from "yu_inventory"."one_c_fixed_asset_inbox"`,
        [batchId],
      );
      await client.query(
        `update "yu_inventory"."one_c_fixed_asset_inbox"
         set last_batch_id = $1,
             last_seen_at = coalesce(last_seen_at, received_at)`,
        [batchId],
      );
    }

    await client.query("commit");
    console.log(
      JSON.stringify({
        target,
        batchId: batchId ?? "existing",
        sourceSha256,
        rows: inbox.rowCount,
        verified: false,
        massPublicationBlocked: true,
      }),
    );
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "1C reconciliation backfill failed.",
  );
  process.exitCode = 1;
});
