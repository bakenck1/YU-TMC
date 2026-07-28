import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import { readDatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";

async function main() {
  const target = parseTargetArgument(process.argv.slice(2));

  loadTargetEnvironment(target);

  const config = readDatabaseConfig({
    purpose: "migration",
    target,
  });

  await migrateDatabase(config);
  console.log(`Database migrations completed for ${target}.`);
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
