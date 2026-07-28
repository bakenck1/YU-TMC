import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readDatabaseConfig } from "../../lib/db/env";
import { createPostgresPool } from "../../lib/db/pool";

export const E2E_DATA_DIRECTORY =
  process.env.YU_E2E_DATA_DIRECTORY ??
  path.join(tmpdir(), `yu-inventory-playwright-auth-${randomUUID()}`);

export const E2E_WEBHOOK_FILE = path.join(
  E2E_DATA_DIRECTORY,
  "password-reset-webhook.json",
);

function assertSafeDirectory() {
  const resolved = path.resolve(E2E_DATA_DIRECTORY);
  const expectedParent = path.resolve(tmpdir());
  if (
    path.dirname(resolved) !== expectedParent ||
    !path.basename(resolved).startsWith("yu-inventory-playwright-auth-")
  ) {
    throw new Error(`Refusing to reset unsafe E2E directory: ${resolved}`);
  }
  return resolved;
}

export async function resetE2EData() {
  const directory = assertSafeDirectory();
  await resetE2EDatabase();
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

export async function removeE2EData() {
  await rm(assertSafeDirectory(), { recursive: true, force: true });
}

async function resetE2EDatabase() {
  const config = readDatabaseConfig({
    purpose: "migration",
    target: "test",
  });
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a non-test E2E database.");
  }

  const pool = createPostgresPool(config, { max: 1 });
  try {
    await pool.query("begin");
    try {
      await pool.query(
        `truncate table "yu_inventory"."users" cascade`,
      );
      await pool.query(
        `alter sequence "yu_inventory"."user_code_sequence" restart with 1`,
      );
      await pool.query(
        `insert into "yu_inventory"."auth_bootstrap" ("singleton")
         values (true)`,
      );
      await pool.query("commit");
    } catch (error) {
      await pool.query("rollback");
      throw error;
    }
  } finally {
    await pool.end();
  }
}
