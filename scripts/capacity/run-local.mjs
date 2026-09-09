import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initdb, pg_ctl } from "@embedded-postgres/windows-x64";
import pg from "pg";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Local capacity runner supports Windows x64 only; use capacity:baseline against a prepared PostgreSQL database elsewhere.");
const root = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "yu-capacity-"));
const data = path.join(work, "data");
const passwordFile = path.join(work, "password.txt");
const port = 55449;
const migrator = "yu_capacity_migrator";
const runtime = "yu_capacity_runtime";
const database = "yu_capacity_test";
const migratorPassword = randomBytes(24).toString("hex");
const runtimePassword = randomBytes(24).toString("hex");
const packagedNativeDirectory = path.dirname(path.dirname(initdb));
const localNativeDirectory = path.join(work, "native");
const copied = spawnSync("robocopy.exe", [packagedNativeDirectory, localNativeDirectory, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], { stdio: "inherit", windowsHide: true });
if (copied.error) throw copied.error;
if ((copied.status ?? 16) > 7) throw new Error(`robocopy.exe exited with code ${copied.status ?? 16}`);
const binaries = path.join(localNativeDirectory, "bin");
const localInitdb = path.join(binaries, path.basename(initdb));
const localPgCtl = path.join(binaries, path.basename(pg_ctl));
const baseEnvironment = { ...process.env, LC_MESSAGES: "C", PATH: `${binaries};${process.env.PATH ?? ""}` };
let started = false;

try {
  mkdirSync(data, { recursive: true });
  writeFileSync(passwordFile, `${migratorPassword}\n`, { mode: 0o600 });
  run(localInitdb, [`--pgdata=${data}`, "--auth=scram-sha-256", `--username=${migrator}`, `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"]);
  rmSync(passwordFile, { force: true });
  run(localPgCtl, ["-D", data, "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  started = true;
  const adminUrl = `postgresql://${migrator}:${migratorPassword}@127.0.0.1:${port}/postgres`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create role ${runtime} login password '${runtimePassword}'`);
    await admin.query(`create database ${database}`);
  } finally { await admin.end(); }
  const environment = {
    ...baseEnvironment,
    NODE_ENV: "test",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
    SESSION_SECRET: "local-capacity-session-secret-with-at-least-43-characters",
    TEST_DATABASE_DEPLOYMENT_ID: `capacity-local-${randomBytes(8).toString("hex")}`,
    TEST_DATABASE_SSL_MODE: "disable",
    TEST_DATABASE_URL: `postgresql://${runtime}:${runtimePassword}@127.0.0.1:${port}/${database}`,
    TEST_DATABASE_MIGRATOR_URL: `postgresql://${migrator}:${migratorPassword}@127.0.0.1:${port}/${database}`,
    CAPACITY_DATABASE_URL: `postgresql://${runtime}:${runtimePassword}@127.0.0.1:${port}/${database}`,
    CAPACITY_ALLOW_DISPOSABLE_SEED: "1",
    CAPACITY_DISPOSABLE_WORKER_PROBE: "1",
    WEB_PUSH_VAPID_PUBLIC_KEY: Buffer.alloc(65, 1).toString("base64url"),
    WEB_PUSH_VAPID_PRIVATE_KEY: Buffer.alloc(32, 2).toString("base64url"),
    WEB_PUSH_VAPID_SUBJECT: "mailto:capacity@example.invalid",
  };
  run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/db/migrate.ts", "--target=test"], environment);
  run(process.execPath, ["scripts/capacity/seed-disposable.mjs"], environment);
  run(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/capacity/measure.mjs"], environment);
} finally {
  if (started) run(localPgCtl, ["-D", data, "stop", "-m", "fast", "-w"], baseEnvironment, false);
  rmSync(work, { recursive: true, force: true });
}

function run(command, args, environment = baseEnvironment, fail = true) {
  const result = spawnSync(command, args, { cwd: command === process.execPath ? root : work, env: environment, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (fail && result.status !== 0) throw new Error(`${path.basename(command)} exited with code ${result.status ?? 1}`);
  return result.status ?? 1;
}
