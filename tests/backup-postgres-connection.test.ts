import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("backup connection helper allows different hosts while binding the same database", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-inventory-backup-"));
  try {
    const databaseFile = path.join(directory, "migrator-url");
    const runtimeDatabaseFile = path.join(directory, "runtime-url");
    const pgpassFile = path.join(directory, "pgpass");
    const connectionFile = path.join(directory, "connection");
    const runtimeConnectionFile = path.join(directory, "runtime-connection");
    await writeFile(
      databaseFile,
      "postgresql://migration%3Auser:p%40ss%3Aword@db-primary:5432/yu_inventory",
    );
    await writeFile(
      runtimeDatabaseFile,
      "postgresql://runtime%3Auser:r%40untime%3Apass@db-replica:6432/yu_inventory",
    );

    await execFileAsync(
      process.execPath,
      [path.resolve("deploy/backup-postgres-connection.mjs")],
      {
        env: {
          ...process.env,
          YU_DATABASE_FILE: databaseFile,
          YU_RUNTIME_DATABASE_FILE: runtimeDatabaseFile,
          YU_PGPASS_FILE: pgpassFile,
          YU_CONNECTION_FILE: connectionFile,
          YU_RUNTIME_CONNECTION_FILE: runtimeConnectionFile,
        },
        windowsHide: true,
      },
    );

    assert.equal(
      await readFile(connectionFile, "utf8"),
      "postgresql://migration%3Auser@db-primary:5432/yu_inventory\n1\n",
    );
    assert.equal(
      await readFile(pgpassFile, "utf8"),
      "*:*:*:migration\\:user:p@ss\\:word\n*:*:*:runtime\\:user:r@untime\\:pass\n",
    );
    assert.equal(
      await readFile(runtimeConnectionFile, "utf8"),
      "postgresql://runtime%3Auser@db-replica:6432/yu_inventory\n1\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup connection helper rejects a migrator URL for another database", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "yu-inventory-backup-"));
  try {
    const databaseFile = path.join(directory, "migrator-url");
    const runtimeDatabaseFile = path.join(directory, "runtime-url");
    const pgpassFile = path.join(directory, "pgpass");
    const connectionFile = path.join(directory, "connection");
    const runtimeConnectionFile = path.join(directory, "runtime-connection");
    await writeFile(databaseFile, "postgresql://migration@db-primary/other_database");
    await writeFile(runtimeDatabaseFile, "postgresql://runtime@db-replica/yu_inventory");

    const failure = await execFileAsync(
      process.execPath,
      [path.resolve("deploy/backup-postgres-connection.mjs")],
      {
        env: {
          ...process.env,
          YU_DATABASE_FILE: databaseFile,
          YU_RUNTIME_DATABASE_FILE: runtimeDatabaseFile,
          YU_PGPASS_FILE: pgpassFile,
          YU_CONNECTION_FILE: connectionFile,
          YU_RUNTIME_CONNECTION_FILE: runtimeConnectionFile,
        },
        windowsHide: true,
      },
    ).catch((error: unknown) => error as { stderr?: string });

    assert.match(failure.stderr ?? "", /same database/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup connection helper enforces query-free distinct database roles", async () => {
  const cases = [
    {
      name: "runtime query",
      migrator: "postgresql://migration@db-primary/yu_inventory",
      runtime: "postgresql://runtime@db-replica/yu_inventory?sslmode=verify-full",
      message: /query-free PostgreSQL URL/,
    },
    {
      name: "missing runtime role",
      migrator: "postgresql://migration@db-primary/yu_inventory",
      runtime: "postgresql://db-replica/yu_inventory",
      message: /query-free PostgreSQL URL/,
    },
    {
      name: "same role",
      migrator: "postgresql://shared@db-primary/yu_inventory",
      runtime: "postgresql://shared@db-replica/yu_inventory",
      message: /different PostgreSQL role/,
    },
  ];

  for (const testCase of cases) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yu-inventory-backup-"));
    try {
      const databaseFile = path.join(directory, "migrator-url");
      const runtimeDatabaseFile = path.join(directory, "runtime-url");
      const pgpassFile = path.join(directory, "pgpass");
      const connectionFile = path.join(directory, "connection");
      const runtimeConnectionFile = path.join(directory, "runtime-connection");
      await writeFile(databaseFile, testCase.migrator);
      await writeFile(runtimeDatabaseFile, testCase.runtime);

      const failure = await execFileAsync(
        process.execPath,
        [path.resolve("deploy/backup-postgres-connection.mjs")],
        {
          env: {
            ...process.env,
            YU_DATABASE_FILE: databaseFile,
            YU_RUNTIME_DATABASE_FILE: runtimeDatabaseFile,
            YU_PGPASS_FILE: pgpassFile,
            YU_CONNECTION_FILE: connectionFile,
            YU_RUNTIME_CONNECTION_FILE: runtimeConnectionFile,
          },
          windowsHide: true,
        },
      ).catch((error: unknown) => error as { stderr?: string });

      assert.match(failure.stderr ?? "", testCase.message, testCase.name);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
