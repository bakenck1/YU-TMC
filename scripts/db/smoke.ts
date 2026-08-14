import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import {
  DatabaseOperationError,
  readDatabaseConfig,
} from "@/lib/db/env";
import {
  assertDatabaseMigrationHistory,
  readLocalMigrationManifest,
} from "@/lib/db/migration-manifest";
import { createPostgresPool } from "@/lib/db/pool";
import { assertSchemaContract } from "@/lib/db/schema-contract";

async function main() {
  const target = parseTargetArgument(process.argv.slice(2));

  loadTargetEnvironment(target);

  const runtimeConfig = readDatabaseConfig({
    purpose: "runtime",
    target,
  });
  const migrationConfig = readDatabaseConfig({
    purpose: "migration",
    target,
  });
  const runtimePool = createPostgresPool(runtimeConfig, { max: 1 });
  const migrationPool = createPostgresPool(migrationConfig, { max: 1 });
  const manifest = readLocalMigrationManifest();

  try {
    await assertDatabaseMigrationHistory(migrationPool, manifest, {
      allowPending: false,
    });

    const privilegeResult = await runtimePool.query<{
      has_usage: boolean;
      can_create_objects: boolean;
      can_use_migration_schema: boolean;
      can_read_migration_history: boolean;
      can_write_migration_history: boolean;
      can_delete_push_subscriptions: boolean;
      can_delete_settings: boolean;
      can_insert_settings: boolean;
    }>(
      `select coalesce(
         has_schema_privilege(current_user, 'yu_inventory', 'USAGE'),
         false
       ) as has_usage,
       coalesce(
         has_schema_privilege(current_user, 'yu_inventory', 'CREATE'),
         false
       ) as can_create_objects,
       coalesce(
         has_schema_privilege(current_user, 'yu_migrations', 'USAGE'),
         false
       ) as can_use_migration_schema,
       coalesce(
         has_table_privilege(
           current_user,
           '"yu_migrations"."__drizzle_migrations"',
           'SELECT'
         ),
         false
       ) as can_read_migration_history,
       coalesce(
         has_table_privilege(
           current_user,
           '"yu_migrations"."__drizzle_migrations"',
           'INSERT'
         ),
         false
       ) as can_write_migration_history,
       coalesce(
         has_table_privilege(
           current_user,
           '"yu_inventory"."web_push_subscriptions"',
           'DELETE'
         ),
         false
       ) as can_delete_push_subscriptions,
       coalesce(
         has_table_privilege(
           current_user,
           '"yu_inventory"."settings"',
           'DELETE'
         ),
         false
       ) as can_delete_settings,
       coalesce(
         has_table_privilege(
           current_user,
           '"yu_inventory"."settings"',
           'INSERT'
         ),
         false
       ) as can_insert_settings`,
    );

    if (privilegeResult.rows[0]?.has_usage !== true) {
      throw new DatabaseOperationError(
        "Runtime database role cannot use the application schema.",
      );
    }
    if (privilegeResult.rows[0]?.can_create_objects === true) {
      throw new DatabaseOperationError(
        "Runtime database role can create application schema objects.",
      );
    }
    if (privilegeResult.rows[0]?.can_use_migration_schema === true) {
      throw new DatabaseOperationError(
        "Runtime database role can use the private migration schema.",
      );
    }
    if (privilegeResult.rows[0]?.can_read_migration_history === true) {
      throw new DatabaseOperationError(
        "Runtime database role can read private migration history.",
      );
    }
    if (privilegeResult.rows[0]?.can_write_migration_history === true) {
      throw new DatabaseOperationError(
        "Runtime database role can write private migration history.",
      );
    }
    if (
      privilegeResult.rows[0]?.can_delete_push_subscriptions !== true
    ) {
      throw new DatabaseOperationError(
        "Runtime database role cannot delete web push subscriptions.",
      );
    }
    if (privilegeResult.rows[0]?.can_delete_settings === true) {
      throw new DatabaseOperationError(
        "Runtime database role can delete the settings singleton.",
      );
    }
    if (privilegeResult.rows[0]?.can_insert_settings === true) {
      throw new DatabaseOperationError(
        "Runtime database role can insert additional settings rows.",
      );
    }

    await assertSchemaContract(
      runtimePool,
      runtimeConfig,
      manifest,
      {
        allowMissing: false,
        allowStale: false,
      },
    );

    // Execute the same column predicates used when assigning an inspection.
    // This catches repository SQL/schema drift (for example active vs is_active)
    // even when the database does not yet contain assignable technicians.
    await runtimePool.query(
      `select id, role
         from "yu_inventory"."users"
        where id = $1
          and is_active = true
          and deleted_at is null
          and role in ('warehouse', 'employee')
        for share`,
      ["00000000-0000-0000-0000-000000000000"],
    );

    const settingsCount = await runtimePool.query<{ record_count: number }>(
      `select count(*)::int as record_count
         from "yu_inventory"."settings"`,
    );
    if (settingsCount.rows[0]?.record_count !== 1) {
      throw new DatabaseOperationError(
        "The settings singleton must exist exactly once.",
      );
    }

    await assertRuntimeSettingsDeleteRejected(runtimePool);
    await assertMigratorSettingsDeleteRejected(migrationPool);
    await runtimePool.query(
      `select s.id, s.user_id, s.endpoint, s.p256dh, s.auth,
              s.expiration_time, s.user_agent, s.created_at, s.updated_at
         from "yu_inventory"."web_push_subscriptions" s
         join "yu_inventory"."users" u on u.id = s.user_id
        where s.user_id = $1
          and u.is_active = true
          and u.deleted_at is null
          and u.role in ('warehouse', 'employee')
        limit 0`,
      ["00000000-0000-0000-0000-000000000000"],
    );

    console.log(`Database smoke check passed for ${target}.`);
  } finally {
    await Promise.all([runtimePool.end(), migrationPool.end()]);
  }
}

async function assertRuntimeSettingsDeleteRejected(
  runtimePool: ReturnType<typeof createPostgresPool>,
): Promise<void> {
  try {
    await runtimePool.query(
      `delete from "yu_inventory"."settings" where id = 'global'`,
    );
  } catch (error) {
    if (postgresErrorCode(error) !== "42501") {
      throw new DatabaseOperationError(
        "Runtime settings delete was rejected for an unexpected reason.",
      );
    }
    return;
  }
  throw new DatabaseOperationError(
    "Runtime database role unexpectedly deleted the settings singleton.",
  );
}

async function assertMigratorSettingsDeleteRejected(
  migrationPool: ReturnType<typeof createPostgresPool>,
): Promise<void> {
  const client = await migrationPool.connect();
  try {
    await client.query("begin");
    let deletionError: unknown;
    try {
      await client.query(
        `delete from "yu_inventory"."settings" where id = 'global'`,
      );
    } catch (error) {
      deletionError = error;
    }
    await client.query("rollback");
    if (postgresErrorCode(deletionError) !== "55006") {
      throw new DatabaseOperationError(
        "Migration settings delete was not rejected by the protection trigger.",
      );
    }
    return;
  } finally {
    client.release();
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
