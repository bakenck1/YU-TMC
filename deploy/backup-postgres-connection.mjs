import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const postgresProtocols = new Set(["postgres:", "postgresql:"]);

function readDatabaseName(source, label) {
  let value;
  try {
    value = decodeURIComponent(source.pathname.slice(1));
  } catch {
    throw new Error(`${label} contains an invalid database name.`);
  }
  if (!value || value.includes("/")) {
    throw new Error(`${label} contains an invalid database name.`);
  }
  return value;
}

function escapePgpass(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

export function buildBackupConnection({ migratorUrl, runtimeUrl }) {
  let source;
  let runtime;
  try {
    source = new URL(migratorUrl);
    runtime = new URL(runtimeUrl);
  } catch {
    throw new Error("Database URLs must be valid PostgreSQL URLs.");
  }
  if (
    !postgresProtocols.has(source.protocol) ||
    !source.hostname ||
    !source.username ||
    source.pathname.length < 2 ||
    source.search ||
    source.hash
  ) {
    throw new Error(
      "DATABASE_MIGRATOR_URL must be a query-free PostgreSQL URL with a user and database.",
    );
  }
  if (
    !postgresProtocols.has(runtime.protocol) ||
    !runtime.hostname ||
    !runtime.username ||
    runtime.pathname.length < 2 ||
    runtime.search ||
    runtime.hash
  ) {
    throw new Error(
      "DATABASE_URL must be a query-free PostgreSQL URL with a user and database.",
    );
  }

  const migratorDatabaseName = readDatabaseName(source, "DATABASE_MIGRATOR_URL");
  const runtimeDatabaseName = readDatabaseName(runtime, "DATABASE_URL");
  if (migratorDatabaseName !== runtimeDatabaseName) {
    throw new Error("DATABASE_URL and DATABASE_MIGRATOR_URL must target the same database.");
  }

  let migratorUsername;
  let migratorPassword;
  let runtimeUsername;
  let runtimePassword;
  try {
    migratorUsername = decodeURIComponent(source.username);
    migratorPassword = decodeURIComponent(source.password);
    runtimeUsername = decodeURIComponent(runtime.username);
    runtimePassword = decodeURIComponent(runtime.password);
  } catch {
    throw new Error("Database URLs contain invalid credentials.");
  }
  if (!migratorUsername || !runtimeUsername) {
    throw new Error("Database URLs must include non-empty PostgreSQL roles.");
  }
  if (migratorUsername === runtimeUsername) {
    throw new Error(
      "DATABASE_MIGRATOR_URL must use a different PostgreSQL role than DATABASE_URL.",
    );
  }
  const pgpassEntries = [
    migratorPassword
      ? `*:*:*:${escapePgpass(migratorUsername)}:${escapePgpass(migratorPassword)}\n`
      : "",
    runtimePassword
      ? `*:*:*:${escapePgpass(runtimeUsername)}:${escapePgpass(runtimePassword)}\n`
      : "",
  ].filter(Boolean);
  return {
    connectionUrl: `${source.protocol}//${source.username}@${source.host}${source.pathname}`,
    runtimeConnectionUrl: `${runtime.protocol}//${runtime.username ? `${runtime.username}@` : ""}${runtime.host}${runtime.pathname}`,
    migratorPasswordAvailable: Boolean(migratorPassword),
    runtimePasswordAvailable: Boolean(runtimePassword),
    pgpass: pgpassEntries.join(""),
  };
}

export function prepareBackupConnection({
  databaseFile,
  runtimeDatabaseFile,
  pgpassFile,
  connectionFile,
  runtimeConnectionFile,
}) {
  const result = buildBackupConnection({
    migratorUrl: readFileSync(databaseFile, "utf8").trim(),
    runtimeUrl: readFileSync(runtimeDatabaseFile, "utf8").trim(),
  });
  writeFileSync(pgpassFile, result.pgpass, { mode: 0o600 });
  writeFileSync(
    connectionFile,
    `${result.connectionUrl}\n${result.migratorPasswordAvailable ? "1" : "0"}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    runtimeConnectionFile,
    `${result.runtimeConnectionUrl}\n${result.runtimePasswordAvailable ? "1" : "0"}\n`,
    { mode: 0o600 },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareBackupConnection({
    databaseFile: process.env.YU_DATABASE_FILE,
    runtimeDatabaseFile: process.env.YU_RUNTIME_DATABASE_FILE,
    pgpassFile: process.env.YU_PGPASS_FILE,
    connectionFile: process.env.YU_CONNECTION_FILE,
    runtimeConnectionFile: process.env.YU_RUNTIME_CONNECTION_FILE,
  });
}
