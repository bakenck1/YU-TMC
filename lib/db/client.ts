import "server-only";

import { createHash } from "node:crypto";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { readDatabaseConfig } from "@/lib/db/env";
import { createPostgresPool } from "@/lib/db/pool";

interface CachedDatabase {
  database: NodePgDatabase;
  pool: Pool;
  signature: string;
}

const globalDatabase = globalThis as typeof globalThis & {
  __yuInventoryDatabase?: CachedDatabase;
};

let processDatabase: CachedDatabase | undefined;

/**
 * Lazily creates the database client. Importing this module during `next build`
 * does not require database environment variables or open a connection.
 */
export function getDatabase(): NodePgDatabase {
  return getCachedDatabase().database;
}

export function getDatabasePool(): Pool {
  return getCachedDatabase().pool;
}

export function createDrizzleDatabase(pool: Pool): NodePgDatabase {
  return drizzle({ casing: "snake_case", client: pool });
}

export async function closeDatabase(): Promise<void> {
  const cached = processDatabase ?? globalDatabase.__yuInventoryDatabase;

  if (!cached) {
    return;
  }

  if (globalDatabase.__yuInventoryDatabase === cached) {
    globalDatabase.__yuInventoryDatabase = undefined;
  }

  if (processDatabase === cached) {
    processDatabase = undefined;
  }

  await cached.pool.end();
}

function getCachedDatabase(): CachedDatabase {
  const config = readDatabaseConfig({ purpose: "runtime" });
  const signature = createHash("sha256")
    .update(
      [
        config.connectionString,
        config.connectionTimeoutMs,
        config.deploymentId,
        config.idleTimeoutMs,
        config.poolMax,
        config.sslCa ?? "",
        config.sslMode,
        config.statementTimeoutMs,
      ].join("\0"),
    )
    .digest("hex");
  const cached =
    config.target === "development"
      ? globalDatabase.__yuInventoryDatabase
      : processDatabase;

  if (cached) {
    if (cached.signature !== signature) {
      throw new Error(
        "Database configuration changed while the process was running. Restart the server before reconnecting.",
      );
    }

    return cached;
  }

  const pool = createPostgresPool(config);
  const created = {
    database: createDrizzleDatabase(pool),
    pool,
    signature,
  };

  if (config.target === "development") {
    globalDatabase.__yuInventoryDatabase = created;
  } else {
    processDatabase = created;
  }

  return created;
}
