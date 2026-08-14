import path from "node:path";

import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import {
  DatabaseConfigurationError,
  readDatabaseConfig,
} from "@/lib/db/env";
import { importLegacySettings } from "@/lib/db/settings-import";
import { createPostgresPool } from "@/lib/db/pool";
import {
  assertDatabaseMigrationHistory,
  readLocalMigrationManifest,
} from "@/lib/db/migration-manifest";
import { assertSchemaContract } from "@/lib/db/schema-contract";

async function main() {
  const { source, target } = parseArguments(process.argv.slice(2));
  loadTargetEnvironment(target);

  const config = readDatabaseConfig({ purpose: "migration", target });
  const pool = createPostgresPool(config, { max: 1 });
  try {
    const manifest = readLocalMigrationManifest();
    await assertDatabaseMigrationHistory(pool, manifest, {
      allowPending: false,
    });
    await assertSchemaContract(pool, config, manifest, {
      allowMissing: false,
      allowStale: false,
    });

    const outcome = await importLegacySettings(pool, {
      ...(source ? { filename: path.resolve(source) } : {}),
    });
    const message = {
      imported: "Legacy settings imported into PostgreSQL.",
      skipped:
        "Legacy settings were already imported or the singleton was explicitly changed; no changes made.",
      missing:
        "No legacy settings source exists; PostgreSQL defaults remain active.",
    }[outcome];
    console.log(message);
  } finally {
    await pool.end();
  }
}

function parseArguments(args: string[]) {
  const targetArguments: string[] = [];
  let source: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--source=")) {
      source = argument.slice("--source=".length);
      continue;
    }
    if (argument === "--source") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new DatabaseConfigurationError(
          "The --source option requires a file path.",
        );
      }
      source = value;
      index += 1;
      continue;
    }
    targetArguments.push(argument);
  }

  if (source === "") {
    throw new DatabaseConfigurationError(
      "The --source option requires a file path.",
    );
  }
  return { source, target: parseTargetArgument(targetArguments) };
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
