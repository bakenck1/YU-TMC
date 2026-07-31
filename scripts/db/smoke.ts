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
      can_delete_push_subscriptions: boolean;
    }>(
      `select coalesce(
         has_schema_privilege(current_user, 'yu_inventory', 'USAGE'),
         false
       ) as has_usage,
       coalesce(
         has_table_privilege(
           current_user,
           '"yu_inventory"."web_push_subscriptions"',
           'DELETE'
         ),
         false
       ) as can_delete_push_subscriptions`,
    );

    if (privilegeResult.rows[0]?.has_usage !== true) {
      throw new DatabaseOperationError(
        "Runtime database role cannot use the application schema.",
      );
    }
    if (
      privilegeResult.rows[0]?.can_delete_push_subscriptions !== true
    ) {
      throw new DatabaseOperationError(
        "Runtime database role cannot delete web push subscriptions.",
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

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
