import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PoolClient } from "pg";

import {
  DatabaseOperationError,
  type DatabaseConfig,
} from "@/lib/db/env";
import { createPostgresPool } from "@/lib/db/pool";
import {
  assertDatabaseMigrationHistory,
  readLocalMigrationManifest,
} from "@/lib/db/migration-manifest";
import {
  assertSchemaContract,
  writeSchemaContract,
} from "@/lib/db/schema-contract";

const MIGRATION_LOCK_KEY = 211102026;
const MIGRATION_POLL_INTERVAL_MS = 250;

export interface MigrationResult {
  manifestHash: string;
  target: DatabaseConfig["target"];
}

/**
 * Runs committed, forward-only migrations under a session advisory lock.
 * The lock and migrator share one dedicated PostgreSQL connection.
 */
export async function migrateDatabase(
  config: DatabaseConfig,
): Promise<MigrationResult> {
  if (config.purpose !== "migration") {
    throw new DatabaseOperationError(
      "Migration configuration is required to run migrations.",
    );
  }

  const pool = createPostgresPool(config, { max: 1 });
  const manifest = readLocalMigrationManifest();
  let client: PoolClient | undefined;
  let locked = false;
  let operationError: unknown;

  try {
    client = await pool.connect();
    locked = await acquireMigrationLock(
      client,
      config.migrationLockTimeoutMs,
    );

    if (!locked) {
      throw new DatabaseOperationError(
        `Could not acquire the database migration lock within ${config.migrationLockTimeoutMs}ms.`,
      );
    }

    const database = drizzle({ client });
    await assertDatabaseMigrationHistory(client, manifest, {
      allowPending: true,
    });

    await assertSchemaContract(client, config, manifest, {
      allowMissing: true,
      allowStale: true,
    });

    await migrate(database, {
      migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      migrationsSchema: "yu_migrations",
      migrationsTable: "__drizzle_migrations",
    });

    await assertDatabaseMigrationHistory(client, manifest, {
      allowPending: false,
    });
    await writeSchemaContract(client, config, manifest);
    await assertSchemaContract(client, config, manifest, {
      allowMissing: false,
      allowStale: false,
    });
    await assertRuntimeEndpoint(config, manifest);

    return {
      manifestHash: manifest.fingerprint,
      target: config.target,
    };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let cleanupError: unknown;

    if (client && locked) {
      try {
        await client.query("select pg_advisory_unlock($1)", [
          MIGRATION_LOCK_KEY,
        ]);
      } catch (error) {
        cleanupError = error;
      }
    }

    client?.release();

    try {
      await pool.end();
    } catch (error) {
      cleanupError ??= error;
    }

    if (operationError === undefined && cleanupError !== undefined) {
      throw cleanupError;
    }
  }
}

async function assertRuntimeEndpoint(
  migrationConfig: DatabaseConfig,
  manifest: ReturnType<typeof readLocalMigrationManifest>,
): Promise<void> {
  const runtimeConfig: DatabaseConfig = {
    ...migrationConfig,
    applicationName: `yu-inventory-${migrationConfig.target}-runtime-verification`,
    connectionString: migrationConfig.runtimeConnectionString,
    purpose: "runtime",
  };
  const runtimePool = createPostgresPool(runtimeConfig, { max: 1 });

  try {
    await assertSchemaContract(runtimePool, runtimeConfig, manifest, {
      allowMissing: false,
      allowStale: false,
    });
  } finally {
    await runtimePool.end();
  }
}

async function acquireMigrationLock(
  client: PoolClient,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  do {
    const result = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock($1) as acquired",
      [MIGRATION_LOCK_KEY],
    );

    if (result.rows[0]?.acquired === true) {
      return true;
    }

    await delay(MIGRATION_POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  return false;
}
