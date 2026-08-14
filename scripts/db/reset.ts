import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
} from "@/lib/db/cli";
import { DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import { DatabaseOperationError, readDatabaseConfig } from "@/lib/db/env";
import {
  assertDatabaseMigrationHistory,
  readLocalMigrationManifest,
} from "@/lib/db/migration-manifest";
import { createPostgresPool } from "@/lib/db/pool";
import { assertSchemaContract } from "@/lib/db/schema-contract";

const APPLICATION_TABLES = [
  "notification_receipts",
  "notification_deliveries",
  "notification_events",
  "notification_mailboxes",
  "item_result_revisions",
  "item_results",
  "inspection_room_items",
  "inspection_rooms",
  "deviation_decisions",
  "transfers",
  "responsibility_periods",
  "photos",
  "qr_identifiers",
  "item_inventory_number_history",
  "items",
  "inspections",
  "rooms",
  "buildings",
  "idempotency_requests",
  "audit_records",
  "settings",
  "user_password_credentials",
  "auth_bootstrap",
  "users",
] as const;

const RESET_CONFIRMATION = "DELETE_ALL_APPLICATION_DATA";

async function main() {
  const target = parseResetArguments(process.argv.slice(2));
  if (target !== "development") {
    throw new DatabaseOperationError(
      "This command only resets the development database. It never resets test or production.",
    );
  }

  loadTargetEnvironment(target);
  const config = readDatabaseConfig({ purpose: "migration", target });
  const pool = createPostgresPool(config, { max: 1 });

  try {
    const manifest = readLocalMigrationManifest();
    await assertDatabaseMigrationHistory(pool, manifest, { allowPending: false });
    await assertSchemaContract(pool, config, manifest, {
      allowMissing: false,
      allowStale: false,
    });

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext('yu_inventory.reset.development.v1'))",
      );
      await client.query(
        `truncate table ${APPLICATION_TABLES.map(
          (table) => `"yu_inventory"."${table}"`,
        ).join(", ")} restart identity cascade`,
      );
      await client.query(
        'alter sequence "yu_inventory"."user_code_sequence" restart with 1',
      );
      await client.query(
        'insert into "yu_inventory"."auth_bootstrap" ("singleton") values (true)',
      );
      await client.query(
        `insert into "yu_inventory"."settings" ("id", "payload")
         values ('global', $1::jsonb)`,
        [DEFAULT_APP_SETTINGS],
      );
      await assertResetState(client);
      await client.query("commit");
      console.log(
        "Development application data was cleared. Migrations and schema were preserved.",
      );
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function assertResetState(client: {
  query: <Row extends Record<string, unknown>>(
    query: string,
  ) => Promise<{ rows: Row[] }>;
}): Promise<void> {
  for (const table of APPLICATION_TABLES) {
    const result = await client.query<{ record_count: number }>(
      `select count(*)::int as record_count from "yu_inventory"."${table}"`,
    );
    const expectedCount =
      table === "auth_bootstrap" || table === "settings" ? 1 : 0;
    if (result.rows[0]?.record_count !== expectedCount) {
      throw new DatabaseOperationError(
        `Database reset verification failed for ${table}.`,
      );
    }
  }
}

function parseResetArguments(args: string[]): "development" {
  let target: string | undefined;
  let confirmation: string | undefined;

  for (const argument of args) {
    if (argument.startsWith("--target=")) {
      target = argument.slice("--target=".length);
      continue;
    }
    if (argument.startsWith("--confirm=")) {
      confirmation = argument.slice("--confirm=".length);
      continue;
    }
    throw new DatabaseOperationError("Unsupported database reset argument.");
  }

  if (target !== "development") {
    throw new DatabaseOperationError(
      "Pass exactly --target=development to reset the local development database.",
    );
  }
  if (confirmation !== RESET_CONFIRMATION) {
    throw new DatabaseOperationError(
      `Pass --confirm=${RESET_CONFIRMATION} to confirm the data deletion.`,
    );
  }
  return target;
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
