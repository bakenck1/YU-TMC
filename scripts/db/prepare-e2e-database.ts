import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
} from "@/lib/db/cli";
import { readDatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";

async function main() {
  loadTargetEnvironment("test");
  const config = readDatabaseConfig({
    purpose: "migration",
    target: "test",
  });
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to prepare a non-test E2E database.");
  }

  const pool = createPostgresPool(config, { max: 1 });
  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await pool.end();
  }

  await migrateDatabase(config);
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
