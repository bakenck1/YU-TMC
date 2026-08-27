import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";

import {
  formatDatabaseCommandError,
  loadTargetEnvironment,
  parseTargetArgument,
} from "@/lib/db/cli";
import { DatabaseConfigurationError, readDatabaseConfig } from "@/lib/db/env";
import {
  assertDatabaseMigrationHistory,
  readLocalMigrationManifest,
} from "@/lib/db/migration-manifest";
import { createPostgresPool } from "@/lib/db/pool";
import { assertSchemaContract } from "@/lib/db/schema-contract";
import {
  buildPersonnelImportPlan,
  type PersonnelImportCandidate,
} from "@/lib/personnel-import";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const USERS = '"yu_inventory"."users"';
const CODE_SEQUENCE = '"yu_inventory"."user_code_sequence"';

async function main() {
  const { source, target, apply } = parseArguments(process.argv.slice(2));
  const filename = path.resolve(source);
  const sourceStats = await stat(filename);
  if (!sourceStats.isFile() || sourceStats.size > MAX_SOURCE_BYTES) {
    throw new DatabaseConfigurationError(
      "The personnel source must be a JSON file no larger than 50 MB.",
    );
  }
  const parsed = JSON.parse(await readFile(filename, "utf8")) as unknown;
  const plan = buildPersonnelImportPlan(parsed);
  console.log(JSON.stringify(plan.summary, null, 2));
  if (!apply) {
    console.log("Dry run only. Pass --apply to write eligible employees.");
    return;
  }

  loadTargetEnvironment(target);
  const config = readDatabaseConfig({ purpose: "migration", target });
  const pool = createPostgresPool(config, { max: 1 });
  try {
    const manifest = readLocalMigrationManifest();
    await assertDatabaseMigrationHistory(pool, manifest, { allowPending: false });
    await assertSchemaContract(pool, config, manifest, {
      allowMissing: false,
      allowStale: false,
    });
    const result = await pool.connect();
    try {
      await result.query("begin isolation level serializable");
      await result.query(
        "select pg_advisory_xact_lock(hashtext('yu_inventory_personnel_import'))",
      );
      const outcome = { inserted: 0, backfilledIin: 0, existing: 0, iinConflicts: 0 };
      for (const candidate of plan.candidates) {
        await importCandidate(result, candidate, outcome);
      }
      await result.query("commit");
      console.log(JSON.stringify(outcome, null, 2));
    } catch (error) {
      await result.query("rollback");
      throw error;
    } finally {
      result.release();
    }
  } finally {
    await pool.end();
  }
}

async function importCandidate(
  client: PoolClient,
  candidate: PersonnelImportCandidate,
  outcome: { inserted: number; backfilledIin: number; existing: number; iinConflicts: number },
) {
  const existing = await client.query(
    `select id, iin from ${USERS} where email = $1 for update`,
    [candidate.email],
  );
  if (existing.rows[0]) {
    outcome.existing += 1;
    if (!existing.rows[0].iin && candidate.iin) {
      if (await iinAvailable(client, candidate.iin)) {
        await client.query(
          `update ${USERS} set iin = $2, updated_at = now() where id = $1`,
          [existing.rows[0].id, candidate.iin],
        );
        outcome.backfilledIin += 1;
      } else {
        outcome.iinConflicts += 1;
      }
    }
    return;
  }

  const safeIin = candidate.iin && await iinAvailable(client, candidate.iin)
    ? candidate.iin
    : null;
  if (candidate.iin && !safeIin) outcome.iinConflicts += 1;
  await client.query(
    `insert into ${USERS}
       (id, code, email, full_name, iin, role, phone, email_verified,
        is_active, version, created_at, updated_at, deactivated_at, deleted_at)
     values (
       $1, 'USR-' || lpad(nextval('${CODE_SEQUENCE}')::text, 6, '0'),
       $2, $3, $4, 'employee', null, true,
       true, 1, now(), now(), null, null
     )`,
    [randomUUID(), candidate.email, candidate.fullName, safeIin],
  );
  outcome.inserted += 1;
}

async function iinAvailable(
  client: PoolClient,
  iin: string,
) {
  const result = await client.query(
    `select 1 from ${USERS} where iin = $1 and deleted_at is null limit 1`,
    [iin],
  );
  return result.rowCount === 0;
}

function parseArguments(args: string[]) {
  const targetArguments: string[] = [];
  let source = "";
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--apply") {
      apply = true;
    } else if (argument.startsWith("--source=")) {
      source = argument.slice("--source=".length);
    } else if (argument === "--source") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new DatabaseConfigurationError("The --source option requires a file path.");
      }
      source = value;
      index += 1;
    } else {
      targetArguments.push(argument);
    }
  }
  if (!source) {
    throw new DatabaseConfigurationError("Pass exactly one --source path to the personnel JSON file.");
  }
  return { source, target: parseTargetArgument(targetArguments), apply };
}

main().catch((error: unknown) => {
  console.error(formatDatabaseCommandError(error));
  process.exitCode = 1;
});
