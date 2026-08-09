import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { initdb, pg_ctl } from "@embedded-postgres/windows-x64";
import pg from "pg";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("This local PostgreSQL runner supports Windows x64 only.");
}

const root = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "yu-inventory-db-test-"));
const data = path.join(work, "data");
const passwordFile = path.join(work, "password.txt");
const port = 55439;
const migrator = "yu_inventory_test_migrator";
const runtime = "yu_inventory_test_runtime";
const database = "yu_inventory_test";
const migratorPassword = randomBytes(24).toString("hex");
const runtimePassword = randomBytes(24).toString("hex");
const binaryDirectory = path.dirname(initdb);
const processEnvironment = {
  ...process.env,
  LC_MESSAGES: "C",
  PATH: `${binaryDirectory};${process.env.PATH ?? ""}`,
};
let started = false;

try {
  mkdirSync(data, { recursive: true });
  writeFileSync(passwordFile, `${migratorPassword}\n`, { mode: 0o600 });
  run(initdb, [
    `--pgdata=${data}`,
    "--auth=scram-sha-256",
    `--username=${migrator}`,
    `--pwfile=${passwordFile}`,
    "--encoding=UTF8",
    "--locale=C",
  ]);
  rmSync(passwordFile, { force: true });
  run(pg_ctl, ["-D", data, "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  started = true;

  const adminUrl = `postgresql://${migrator}:${migratorPassword}@127.0.0.1:${port}/postgres`;
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`create role ${runtime} login password '${runtimePassword}'`);
    await client.query(`create database ${database}`);
  } finally {
    await client.end();
  }

  const testEnvironment = {
    ...processEnvironment,
    NODE_ENV: "test",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"]
      .filter(Boolean)
      .join(" "),
    SESSION_SECRET: "local-integration-test-session-secret-with-43-characters",
    TEST_DATABASE_DEPLOYMENT_ID: "yu-inventory-local-integration-test",
    TEST_DATABASE_SSL_MODE: "disable",
    TEST_DATABASE_URL:
      `postgresql://${runtime}:${runtimePassword}@127.0.0.1:${port}/${database}`,
    TEST_DATABASE_MIGRATOR_URL:
      `postgresql://${migrator}:${migratorPassword}@127.0.0.1:${port}/${database}`,
  };
  for (const databaseTest of [
    "tests/database/persistent-users.test.ts",
    "tests/database/tmc-operation-migration.test.ts",
  ]) {
    run(process.execPath, [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      databaseTest,
    ], testEnvironment);
  }
} finally {
  if (started) {
    run(pg_ctl, ["-D", data, "stop", "-m", "fast", "-w"], processEnvironment, false);
  }
  rmSync(work, { recursive: true, force: true });
}

function run(command, args, environment = processEnvironment, fail = true) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (fail && result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with code ${result.status ?? 1}`);
  }
  return result.status ?? 1;
}
