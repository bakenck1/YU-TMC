import type { Pool, PoolClient } from "pg";

import {
  DatabaseOperationError,
  type DatabaseConfig,
} from "@/lib/db/env";
import type { MigrationManifest } from "@/lib/db/migration-manifest";

const CONTRACT_TABLE = '"yu_inventory"."__schema_contract"';

interface SchemaContract {
  deploymentId: string;
  manifestHash: string;
}

type Queryable = Pool | PoolClient;

export async function assertSchemaContract(
  database: Queryable,
  config: DatabaseConfig,
  manifest: MigrationManifest,
  options: { allowMissing: boolean; allowStale: boolean },
): Promise<void> {
  const contract = await readSchemaContract(database);

  if (!contract) {
    if (options.allowMissing) {
      return;
    }

    throw new DatabaseOperationError(
      "Database schema contract is missing. Run the committed migrations before using this release.",
    );
  }

  if (contract.deploymentId !== config.deploymentId) {
    throw new DatabaseOperationError(
      "Database deployment identity does not match the configured target.",
    );
  }

  if (!options.allowStale && contract.manifestHash !== manifest.fingerprint) {
    throw new DatabaseOperationError(
      "Database schema contract does not match the committed migration manifest.",
    );
  }
}

export async function writeSchemaContract(
  client: PoolClient,
  config: DatabaseConfig,
  manifest: MigrationManifest,
): Promise<void> {
  const runtimeRole = quoteIdentifier(config.runtimeUsername);

  await client.query("begin");

  try {
    await client.query(
      `insert into ${CONTRACT_TABLE}
         (singleton, deployment_id, manifest_hash, updated_at)
       values (true, $1, $2, transaction_timestamp())
       on conflict (singleton) do update
       set deployment_id = excluded.deployment_id,
           manifest_hash = excluded.manifest_hash,
           updated_at = excluded.updated_at
       where ${CONTRACT_TABLE}.deployment_id is distinct from excluded.deployment_id
          or ${CONTRACT_TABLE}.manifest_hash is distinct from excluded.manifest_hash`,
      [config.deploymentId, manifest.fingerprint],
    );
    await client.query(
      `grant usage on schema "yu_inventory" to ${runtimeRole}`,
    );
    await client.query(
      `grant select on table ${CONTRACT_TABLE} to ${runtimeRole}`,
    );
    await client.query(
      `grant select, insert, update on all tables in schema "yu_inventory" to ${runtimeRole}`,
    );
    await client.query(
      `revoke insert, update on table ${CONTRACT_TABLE} from ${runtimeRole}`,
    );
    await client.query(
      `grant usage, select on all sequences in schema "yu_inventory" to ${runtimeRole}`,
    );
    await client.query("commit");
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the operation error; a broken session will be closed by the
      // migration runner and PostgreSQL will roll the transaction back.
    }
    throw error;
  }
}

async function readSchemaContract(
  database: Queryable,
): Promise<SchemaContract | null> {
  const existsResult = await database.query<{ exists: boolean }>(
    "select to_regclass('yu_inventory.__schema_contract') is not null as exists",
  );

  if (existsResult.rows[0]?.exists !== true) {
    return null;
  }

  const contractResult = await database.query<{
    deployment_id: string;
    manifest_hash: string;
  }>(
    `select deployment_id, manifest_hash
     from ${CONTRACT_TABLE}
     where singleton = true`,
  );
  const row = contractResult.rows[0];

  if (!row) {
    return null;
  }

  return {
    deploymentId: row.deployment_id,
    manifestHash: row.manifest_hash,
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
