import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";

let migrationConfig: DatabaseConfig;
let runtimeConfig: DatabaseConfig;
let databaseWasPrepared = false;

describe("PostgreSQL foundation", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({
      purpose: "migration",
      target: "test",
    });
    runtimeConfig = readDatabaseConfig({
      purpose: "runtime",
      target: "test",
    });

    if (
      decodeURIComponent(new URL(migrationConfig.connectionString).username) ===
      runtimeConfig.runtimeUsername
    ) {
      throw new Error("The PostgreSQL test must use distinct database roles.");
    }

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
    expect(firstState.schemaTables).toEqual([
      "__schema_contract",
      "audit_records",
      "auth_bootstrap",
      "buildings",
      "deviation_decisions",
      "inspection_room_items",
      "inspection_rooms",
      "inspections",
      "item_inventory_number_history",
      "item_result_revisions",
      "item_results",
      "items",
      "notification_deliveries",
      "notification_events",
      "notification_mailboxes",
      "notification_receipts",
      "photos",
      "qr_identifiers",
      "responsibility_periods",
      "rooms",
      "transfers",
      "user_password_credentials",
      "users",
    ]);
    expect(firstState.migrationCount).toBe(3);
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

  it("gives the runtime role only the repository privileges it needs", async () => {
    const pool = createPostgresPool(runtimeConfig, { max: 1 });
    const userId = randomUUID();
    const buildingId = randomUUID();

    try {
      const identity = await pool.query<{
        can_create: boolean;
        current_user: string;
      }>(
        `select current_user,
                has_schema_privilege(
                  current_user,
                  'yu_inventory',
                  'CREATE'
                ) as can_create`,
      );
      expect(identity.rows[0]).toMatchObject({
        can_create: false,
        current_user: runtimeConfig.runtimeUsername,
      });

      await expect(
        pool.query(
          `select deployment_id
           from "yu_inventory"."__schema_contract"
           where singleton = true`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      await pool.query("begin");
      try {
        await pool.query(
          `insert into "yu_inventory"."users"
             (id, code, email, full_name, role, phone, email_verified,
              is_active, created_at, updated_at)
           values (
             $1,
             'USR-' || lpad(
               nextval('"yu_inventory"."user_code_sequence"')::text,
               6,
               '0'
             ),
             $2,
             'Runtime Permission Probe',
             'employee',
             null,
             false,
             true,
             transaction_timestamp(),
             transaction_timestamp()
           )`,
          [userId, `permission-${userId}@example.com`],
        );
        await expect(
          pool.query(
            `update "yu_inventory"."users"
             set full_name = 'Updated Permission Probe'
             where id = $1
             returning id`,
            [userId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          pool.query(
            `select id from "yu_inventory"."users" where id = $1`,
            [userId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        await pool.query(
          `insert into "yu_inventory"."buildings"
             (id, name, name_key, address, address_key,
              created_by, updated_by)
           values ($1, 'Runtime Building', 'runtime building',
                   'Runtime address', 'runtime address', $2, $2)`,
          [buildingId, userId],
        );
        await expect(
          pool.query(
            `update "yu_inventory"."buildings"
             set address = 'Updated runtime address',
                 address_key = 'updated runtime address'
             where id = $1
             returning id`,
            [buildingId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          pool.query(
            `select id
             from "yu_inventory"."buildings"
             where id = $1`,
            [buildingId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await pool.query("rollback");
      }

      await expectPermissionDenied(
        pool.query(`delete from "yu_inventory"."users" where false`),
      );
      await expectPermissionDenied(
        pool.query(
          `update "yu_inventory"."__schema_contract"
           set updated_at = updated_at
           where singleton = true`,
        ),
      );
      await expectPermissionDenied(
        pool.query(
          `update "yu_inventory"."audit_records"
           set action = action
           where false`,
        ),
      );
      await expectPermissionDenied(
        pool.query(`create table "yu_inventory"."runtime_escape" (id int)`),
      );
      await expectPermissionDenied(
        pool.query(
          `select count(*) from "yu_migrations"."__drizzle_migrations"`,
        ),
      );
    } finally {
      await pool.end();
    }
  });
});

async function expectPermissionDenied(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: "42501" });
}

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
