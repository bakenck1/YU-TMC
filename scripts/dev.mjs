import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import nextEnv from "@next/env";
import pgPackage from "pg";

const projectDirectory = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCli = process.env.npm_execpath;
const { loadEnvConfig } = nextEnv;
const { Client } = pgPackage;

loadEnvConfig(projectDirectory, true);

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();

async function runWithEmbeddedPostgres() {
  let packagedInitdb;
  try {
    ({ initdb: packagedInitdb } = await import("@embedded-postgres/windows-x64"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ERR_MODULE_NOT_FOUND") {
      console.warn(
        "@embedded-postgres/windows-x64 is not installed; starting Next.js without the local database fallback. Set DATABASE_URL for database-backed features.",
      );
      return runCommand(["run", "dev:next"], process.env);
    }
    throw error;
  }
  console.log("Preparing automatic local database startup...");
  const databaseDirectory = path.join(
    process.env.YU_INVENTORY_POSTGRES_DATA_DIR?.trim() ||
      path.join(
        process.env.LOCALAPPDATA || tmpdir(),
        "YUInventory",
        "postgres-development",
      ),
  );
  const databaseName = "yu_inventory_dev";
  const databaseUser = "yu_inventory";
  const databasePassword = "local-development-password";
  const databasePort = 5432;
  const databaseUrl =
    `postgresql://${databaseUser}:${databasePassword}` +
    `@127.0.0.1:${databasePort}/${databaseName}`;
  const environment = {
    ...process.env,
    DATABASE_CONNECTION_TIMEOUT_MS: "5000",
    DATABASE_DEPLOYMENT_ID: "yu-inventory-local-development",
    DATABASE_IDLE_TIMEOUT_MS: "30000",
    DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "60000",
    DATABASE_MIGRATOR_URL: databaseUrl,
    DATABASE_POOL_MAX: "5",
    DATABASE_SSL_MODE: "disable",
    DATABASE_STATEMENT_TIMEOUT_MS: "30000",
    DATABASE_URL: databaseUrl,
  };
  const postgres = new WindowsEmbeddedPostgres({
    databaseDir: databaseDirectory,
    password: databasePassword,
    port: databasePort,
    user: databaseUser,
  }, packagedInitdb);

  try {
    if (!existsSync(path.join(databaseDirectory, "PG_VERSION"))) {
      console.log("Preparing the local PostgreSQL database...");
      await postgres.initialise();
    }

    const databaseAlreadyRunning = await isDatabaseAvailable(databaseUrl);
    if (databaseAlreadyRunning) {
      console.log("Using the existing local PostgreSQL database...");
    } else {
      console.log("Starting the local PostgreSQL database...");
      await postgres.start();
    }
    await ensureDatabase(postgres, databaseName);

    const startupCommands = [
      ["run", "db:migrate", "--", "--target=development"],
      ...(process.env.YU_INVENTORY_IMPORT_LEGACY_AUTH === "true"
        ? [["run", "db:import-auth", "--", "--target=development"]]
        : []),
      ["run", "db:smoke", "--", "--target=development"],
    ];
    for (const args of startupCommands) {
      const exitCode = await runCommand(args, environment);
      if (exitCode !== 0) return exitCode;
    }

    console.log("Local database is ready. Starting Next.js...");
    return await runCommand(["run", "dev:next"], environment);
  } catch (error) {
    console.error(
      "Local development startup failed:",
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    await postgres.stop().catch((error) => {
      console.error("[postgres] Failed to stop cleanly:", error);
    });
  }
}

async function isDatabaseAvailable(connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureDatabase(postgres, databaseName) {
  const client = postgres.getPgClient();
  let databaseExists = false;
  await client.connect();
  try {
    const result = await client.query(
      "select 1 from pg_database where datname = $1",
      [databaseName],
    );
    databaseExists = result.rowCount !== 0;
  } finally {
    await client.end();
  }
  if (!databaseExists) {
    await postgres.createDatabase(databaseName);
  }
}

function runCommand(args, environment) {
  return new Promise((resolve, reject) => {
    const command = npmCli ? process.execPath : npmCommand;
    const commandArgs = npmCli ? [npmCli, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: projectDirectory,
      env: environment,
      shell: !npmCli && process.platform === "win32",
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

class WindowsEmbeddedPostgres {
  constructor(options, initdb) {
    this.options = options;
    this.process = null;
    this.binaryDirectory = preparePortablePostgresBinaries(initdb);
  }

  async initialise() {
    const passwordFile = path.join(
      tmpdir(),
      `yu-inventory-postgres-password-${process.pid}.txt`,
    );
    rmSync(this.options.databaseDir, { recursive: true, force: true });
    mkdirSync(path.dirname(this.options.databaseDir), { recursive: true });
    writeFileSync(passwordFile, `${this.options.password}\n`, "utf8");
    try {
      await runProcess(
        path.join(this.binaryDirectory, "initdb.exe"),
        [
          `--pgdata=${this.options.databaseDir}`,
          "--auth=scram-sha-256",
          `--username=${this.options.user}`,
          `--pwfile=${passwordFile}`,
          "--encoding=UTF8",
          "--locale=C",
        ],
        portablePostgresEnvironment(this.binaryDirectory),
      );
    } finally {
      if (existsSync(passwordFile)) unlinkSync(passwordFile);
    }
  }

  async start() {
    this.removeStalePidFile();
    await new Promise((resolve, reject) => {
      let ready = false;
      this.process = spawn(
        path.join(this.binaryDirectory, "postgres.exe"),
        [
          "-D",
          this.options.databaseDir,
          "-h",
          "127.0.0.1",
          "-p",
          String(this.options.port),
        ],
        {
          env: portablePostgresEnvironment(this.binaryDirectory),
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
      this.process.stderr.setEncoding("utf8");
      this.process.stderr.on("data", (message) => {
        const normalized = message.trim();
        if (normalized.includes("database system is ready")) {
          ready = true;
          console.log("[postgres] Database is ready.");
          resolve();
        }
      });
      this.process.once("error", reject);
      this.process.once("exit", (code) => {
        if (!ready) {
          reject(
            new Error(
              `PostgreSQL exited before startup completed (code ${code}).`,
            ),
          );
        }
      });
    });
  }

  removeStalePidFile() {
    const pidFile = path.join(this.options.databaseDir, "postmaster.pid");
    if (!existsSync(pidFile)) return;
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").split(/\r?\n/, 1)[0] ?? "", 10);
    if (Number.isSafeInteger(pid) && isProcessRunning(pid)) return;
    console.warn("Removing a stale local PostgreSQL lock file...");
    unlinkSync(pidFile);
  }

  async stop() {
    if (!this.process) return;
    await runProcess(
      path.join(this.binaryDirectory, "pg_ctl.exe"),
      ["-D", this.options.databaseDir, "stop", "-m", "fast", "-w"],
      portablePostgresEnvironment(this.binaryDirectory),
    );
    this.process = null;
  }

  getPgClient(database = "postgres") {
    return new Client({
      database,
      host: "127.0.0.1",
      password: this.options.password,
      port: this.options.port,
      user: this.options.user,
    });
  }

  async createDatabase(name) {
    const client = this.getPgClient();
    await client.connect();
    try {
      await client.query(`create database ${client.escapeIdentifier(name)}`);
    } finally {
      await client.end();
    }
  }
}

function preparePortablePostgresBinaries(packagedInitdb) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
      "The automatic local PostgreSQL fallback supports Windows x64.",
    );
  }
  const packagedNativeDirectory = path.dirname(path.dirname(packagedInitdb));
  const portableRootDirectory = path.join(
    tmpdir(),
    "yu-inventory-postgres-17.10.0-binaries",
  );
  const portableNativeDirectory = path.join(
    portableRootDirectory,
    "native",
  );
  const portableBinaryDirectory = path.join(
    portableNativeDirectory,
    "bin",
  );
  if (!existsSync(path.join(portableBinaryDirectory, "postgres.exe"))) {
    rmSync(portableRootDirectory, { recursive: true, force: true });
    cpSync(packagedNativeDirectory, portableNativeDirectory, {
      recursive: true,
    });
  }
  return portableBinaryDirectory;
}

function portablePostgresEnvironment(binaryDirectory) {
  return {
    ...process.env,
    LC_MESSAGES: "C",
    PATH: `${binaryDirectory};${process.env.PATH ?? ""}`,
  };
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && error.code === "EPERM");
  }
}

function runProcess(command, args, environment) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (message) => process.stdout.write(message));
    child.stderr.on("data", (message) => {
      stderr += message;
      process.stderr.write(message);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Command ${path.basename(command)} failed (code ${code}). ${stderr}`,
          ),
        );
      }
    });
  });
}

if (configuredDatabaseUrl) {
  process.exitCode = await runCommand(["run", "dev:next"], process.env);
} else {
  process.exitCode = await runWithEmbeddedPostgres();
}
