import { createHash } from "node:crypto";
import path from "node:path";

import {
  readMigrationFiles,
  type MigrationMeta,
} from "drizzle-orm/migrator";
import type { Pool, PoolClient } from "pg";

import { DatabaseOperationError } from "@/lib/db/env";

const MIGRATIONS_SCHEMA = "yu_migrations";
const MIGRATIONS_TABLE = "__drizzle_migrations";

export interface MigrationManifestEntry {
  createdAt: number;
  hash: string;
}

export interface MigrationManifest {
  entries: MigrationManifestEntry[];
  fingerprint: string;
}

export interface AppliedMigration {
  createdAt: number;
  hash: string;
}

type Queryable = Pool | PoolClient;

export function readLocalMigrationManifest(): MigrationManifest {
  const migrations = readMigrationFiles({
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  const entries = migrations.map(toManifestEntry);

  assertStrictlyIncreasing(entries);

  const fingerprint = createHash("sha256")
    .update(
      entries
        .map((entry) => `${entry.createdAt}:${entry.hash}`)
        .join("\n"),
    )
    .digest("hex");

  return { entries, fingerprint };
}

export async function assertDatabaseMigrationHistory(
  database: Queryable,
  manifest: MigrationManifest,
  options: { allowPending: boolean },
): Promise<AppliedMigration[]> {
  const existsResult = await database.query<{ exists: boolean }>(
    `select to_regclass('${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}') is not null as exists`,
  );

  if (existsResult.rows[0]?.exists !== true) {
    validateMigrationState(manifest.entries, [], options);
    return [];
  }

  const historyResult = await database.query<{
    created_at: string;
    hash: string;
  }>(
    `select created_at::text, hash
     from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
     order by created_at, id`,
  );
  const applied = historyResult.rows.map((row) => {
    const createdAt = Number(row.created_at);

    if (!Number.isSafeInteger(createdAt)) {
      throw new DatabaseOperationError(
        "Database migration history contains an invalid timestamp.",
      );
    }

    return { createdAt, hash: row.hash };
  });

  validateMigrationState(manifest.entries, applied, options);
  return applied;
}

export function validateMigrationState(
  local: MigrationManifestEntry[],
  applied: AppliedMigration[],
  { allowPending }: { allowPending: boolean },
): void {
  assertStrictlyIncreasing(local);
  assertStrictlyIncreasing(applied);

  if (applied.length > local.length) {
    throw new DatabaseOperationError(
      "Database migration history contains entries that are not present in this release.",
    );
  }

  for (let index = 0; index < applied.length; index += 1) {
    const expected = local[index];
    const actual = applied[index];

    if (
      expected.createdAt !== actual.createdAt ||
      expected.hash !== actual.hash
    ) {
      throw new DatabaseOperationError(
        "Database migration history has drifted from the committed migration files.",
      );
    }
  }

  if (!allowPending && applied.length !== local.length) {
    throw new DatabaseOperationError(
      "Database has unapplied committed migrations.",
    );
  }
}

function toManifestEntry(migration: MigrationMeta): MigrationManifestEntry {
  return {
    createdAt: migration.folderMillis,
    hash: migration.hash,
  };
}

function assertStrictlyIncreasing(
  entries: Array<{ createdAt: number }>,
): void {
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index]?.createdAt;
    const previous = entries[index - 1]?.createdAt;

    if (!Number.isSafeInteger(current)) {
      throw new DatabaseOperationError(
        "Migration manifest contains an invalid timestamp.",
      );
    }

    if (previous !== undefined && current <= previous) {
      throw new DatabaseOperationError(
        "Migration timestamps must be unique and strictly increasing.",
      );
    }
  }
}
