import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";

let migrationConfig: DatabaseConfig;
let databaseWasPrepared = false;

describe("PostgreSQL foundation", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({
      purpose: "migration",
      target: "test",
    });

    await resetTestSchemas(migrationConfig);
    databaseWasPrepared = true;
  });

  afterAll(async () => {
    if (databaseWasPrepared) {
      await resetTestSchemas(migrationConfig);
    }
  });

  it("serializes concurrent migrations and remains idempotent", async () => {
    const migrationResults = await Promise.all([
      migrateDatabase(migrationConfig),
      migrateDatabase(migrationConfig),
    ]);

    const firstState = await readDatabaseState(migrationConfig);

    expect(firstState.applicationSchemaExists).toBe(true);
    expect(firstState.schemaTables).toEqual(["__schema_contract"]);
    expect(firstState.migrationCount).toBe(1);
    expect(firstState.deploymentId).toBe(migrationConfig.deploymentId);
    expect(firstState.manifestHash).toBe(
      migrationResults[0]?.manifestHash,
    );

    await migrateDatabase(migrationConfig);

    const secondState = await readDatabaseState(migrationConfig);
    expect(secondState).toEqual(firstState);
  });

  it("rejects an applied migration whose committed SQL hash drifted", async () => {
    const pool = createPostgresPool(migrationConfig, { max: 1 });

    try {
      await pool.query(
        'update "yu_migrations"."__drizzle_migrations" set hash = $1',
        ["tampered-migration-hash"],
      );
    } finally {
      await pool.end();
    }

    await expect(migrateDatabase(migrationConfig)).rejects.toThrow(
      /migration history has drifted/,
    );
  });
});

async function resetTestSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }

  const pool = createPostgresPool(config, { max: 1 });

  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await pool.end();
  }
}

async function readDatabaseState(config: DatabaseConfig) {
  const pool = createPostgresPool(config, { max: 1 });

  try {
    const schemaResult = await pool.query<{ exists: boolean }>(
      "select to_regnamespace('yu_inventory') is not null as exists",
    );
    const migrationsResult = await pool.query<{ count: number }>(
      'select count(*)::int as count from "yu_migrations"."__drizzle_migrations"',
    );
    const tablesResult = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'yu_inventory'
       order by table_name`,
    );
    const contractResult = await pool.query<{
      deployment_id: string;
      manifest_hash: string;
    }>(
      `select deployment_id, manifest_hash
       from "yu_inventory"."__schema_contract"
       where singleton = true`,
    );

    return {
      applicationSchemaExists: schemaResult.rows[0]?.exists === true,
      deploymentId: contractResult.rows[0]?.deployment_id,
      manifestHash: contractResult.rows[0]?.manifest_hash,
      migrationCount: migrationsResult.rows[0]?.count ?? 0,
      schemaTables: tablesResult.rows.map((row) => row.table_name),
    };
  } finally {
    await pool.end();
  }
}
