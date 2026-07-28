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

    const privilegeResult = await runtimePool.query<{ has_usage: boolean }>(
      `select coalesce(
         has_schema_privilege(current_user, 'yu_inventory', 'USAGE'),
         false
       ) as has_usage`,
    );

    if (privilegeResult.rows[0]?.has_usage !== true) {
      throw new DatabaseOperationError(
        "Runtime database role cannot use the application schema.",
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

    console.log(`Database smoke check passed for ${target}.`);
  } finally {
    await Promise.all([runtimePool.end(), migrationPool.end()]);
  }
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
