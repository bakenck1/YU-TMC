import { randomUUID } from "node:crypto";

import { UserService } from "@/lib/application/services/user-service";
import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import { readDatabaseConfig } from "@/lib/db/env";
import { createPostgresPool } from "@/lib/db/pool";
import {
  assertDatabaseMigrationHistory,
  readLocalMigrationManifest,
} from "@/lib/db/migration-manifest";
import { assertSchemaContract } from "@/lib/db/schema-contract";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { createPostgresUserRepositories } from "@/lib/server/persistence/postgres/postgres-user-repositories";
import { readLegacyCredential } from "@/lib/server/persistence/legacy/legacy-credential-source";
import { ScryptPasswordHasher } from "@/lib/server/security/scrypt-password-hasher";
import { emitLegacyUsage } from "@/lib/server/observability";

const startedAt = Date.now();
let legacySourceConfigured = false;

async function main() {
  const target = parseTargetArgument(process.argv.slice(2));
  loadTargetEnvironment(target);
  const credential = await readLegacyCredential();
  if (!credential) {
    emitLegacyUsage({ compatibilityId: "LEGACY-AUTH-IMPORT", variant: "not_configured", outcome: "not_configured" }, { duration: Date.now() - startedAt });
    console.log("No legacy credential source is configured; nothing to import.");
    return;
  }
  legacySourceConfigured = true;

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

    const service = new UserService(
      new PostgresUnitOfWork(
        () => pool,
        createPostgresUserRepositories,
      ),
      new ScryptPasswordHasher(),
      { now: () => new Date() },
      { create: () => randomUUID() },
    );
    const outcome = await service.importLegacyCredential(credential);
    emitLegacyUsage({
      compatibilityId: "LEGACY-AUTH-IMPORT",
      variant: "configured",
      outcome: outcome === "imported" ? "imported" : "already_imported",
    }, { duration: Date.now() - startedAt });
    console.log(
      outcome === "imported"
        ? "Legacy credential imported."
        : "Legacy credential was already imported; no changes made.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  emitLegacyUsage({
    compatibilityId: "LEGACY-AUTH-IMPORT",
    variant: legacySourceConfigured ? "configured" : "not_configured",
    outcome: "failed",
  }, { duration: Date.now() - startedAt });
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
