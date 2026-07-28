import { Pool, type PoolConfig } from "pg";

import type { DatabaseConfig } from "@/lib/db/env";

interface CreatePoolOptions {
  max?: number;
}

export function createPostgresPool(
  config: DatabaseConfig,
  options: CreatePoolOptions = {},
): Pool {
  const poolConfig: PoolConfig = {
    allowExitOnIdle: config.target === "test",
    application_name: config.applicationName,
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idle_in_transaction_session_timeout: config.statementTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    max: options.max ?? config.poolMax,
    maxLifetimeSeconds: 300,
    options: "-c search_path=pg_catalog,yu_inventory",
    query_timeout: config.statementTimeoutMs,
    ssl: createSslConfig(config),
    statement_timeout: config.statementTimeoutMs,
  };
  const pool = new Pool(poolConfig);

  pool.on("error", (error) => {
    const databaseError = error as Error & { code?: string };
    const code =
      typeof databaseError.code === "string" ? databaseError.code : "unknown";

    console.error(
      `[database] An idle PostgreSQL connection failed (code: ${code}).`,
    );
  });

  return pool;
}

function createSslConfig(config: DatabaseConfig): PoolConfig["ssl"] {
  if (config.sslMode === "disable") {
    return false;
  }

  if (config.sslMode === "require") {
    return { rejectUnauthorized: false };
  }

  return {
    ca: config.sslCa,
    rejectUnauthorized: true,
  };
}
