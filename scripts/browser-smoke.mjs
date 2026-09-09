import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import pg from "pg";

import { assertDisposableDatabasePair } from "./browser-smoke-safety.mjs";

const root = process.cwd();
const artifactRoot = path.join(root, ".artifacts", "browser-smoke");
assertWorkspacePath(artifactRoot);

const fixtureEnvironment = {
  BROWSER_SMOKE_PASSWORD: "Browser-smoke-Only-42!",
  BROWSER_SMOKE_ADMIN_EMAIL: "browser-smoke-admin@example.invalid",
  BROWSER_SMOKE_OWNER_EMAIL: "browser-smoke-owner@example.invalid",
  BROWSER_SMOKE_RECIPIENT_EMAIL: "browser-smoke-recipient@example.invalid",
  BROWSER_SMOKE_INVENTORY_NUMBER: "E2E-SMOKE-001",
};

let database;
let server;
let failure;
let cleanupPromise;
const serverLog = [];

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => void handleSignal(signal, exitCode));
}

try {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  database = await provisionDatabase();

  const deploymentId = `browser-smoke-${Date.now()}`;
  const testEnvironment = {
    ...safeBaseEnvironment(),
    ...database.environment,
    NODE_ENV: "test",
    NODE_OPTIONS: "--conditions=react-server",
    TEST_DATABASE_DEPLOYMENT_ID: deploymentId,
    TEST_DATABASE_SSL_MODE: "disable",
  };
  runNode(
    ["--conditions=react-server", "--import", "tsx", "scripts/db/prepare-e2e-database.ts"],
    testEnvironment,
  );
  runNode(
    ["--conditions=react-server", "--import", "tsx", "scripts/db/seed-browser-smoke.ts"],
    testEnvironment,
  );

  const applicationPort = await availablePort();
  const baseURL = `http://127.0.0.1:${applicationPort}`;
  const productionEnvironment = {
    ...testEnvironment,
    ...disabledExternalEnvironment(),
    ...fixtureEnvironment,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_DIST_DIR: ".next-e2e",
    YU_INVENTORY_E2E_DATABASE_TARGET: "test",
    APP_DEPLOYMENT_ID: deploymentId,
    SESSION_SECRET: "browser-smoke-session-secret-with-at-least-43-characters",
    APP_PUBLIC_ORIGIN: baseURL,
    BROWSER_SMOKE_BASE_URL: baseURL,
  };

  runNode(["node_modules/next/dist/bin/next", "build"], productionEnvironment);
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(applicationPort)],
    {
      cwd: root,
      env: productionEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    },
  );
  collectLog(server.stdout, serverLog);
  collectLog(server.stderr, serverLog);
  await waitForServer(`${baseURL}/login?manual=1`, server);

  runNode(["node_modules/@playwright/test/cli.js", "test"], productionEnvironment);
  console.log("Browser smoke passed: 2 Chromium journeys.");
} catch (error) {
  failure = error;
} finally {
  const cleanupFailure = await cleanupResources();
  failure ??= cleanupFailure;
  if (failure) {
    await persistFailureEvidence();
    console.error(sanitizeLog(errorMessage(failure)));
    process.exitCode = 1;
  } else {
    await rm(artifactRoot, { recursive: true, force: true });
  }
}

async function provisionDatabase() {
  const runtimeUrl = process.env.TEST_DATABASE_URL?.trim();
  const migratorUrl = process.env.TEST_DATABASE_MIGRATOR_URL?.trim();
  if (Boolean(runtimeUrl) !== Boolean(migratorUrl)) {
    throw new Error("TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL must be supplied together.");
  }
  if (runtimeUrl && migratorUrl) {
    assertDisposableDatabasePair(
      runtimeUrl,
      migratorUrl,
      process.env.BROWSER_SMOKE_DATABASE_RESET_CONFIRMATION?.trim(),
    );
    return {
      environment: { TEST_DATABASE_URL: runtimeUrl, TEST_DATABASE_MIGRATOR_URL: migratorUrl },
      cleanup: () => cleanupSchemas(migratorUrl),
    };
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Provide isolated TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL on this platform.");
  }
  return provisionEmbeddedWindowsDatabase();
}

async function provisionEmbeddedWindowsDatabase() {
  const { initdb, pg_ctl: pgCtl } = await import("@embedded-postgres/windows-x64");
  const work = await mkdtemp(path.join(os.tmpdir(), "yu-browser-smoke-"));
  const data = path.join(work, "data");
  const passwordFile = path.join(work, "password.txt");
  const nativeSource = path.dirname(path.dirname(initdb));
  const nativeRoot = path.join(work, "native");
  const copy = spawnSync("robocopy.exe", [nativeSource, nativeRoot, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], {
    cwd: work,
    stdio: "inherit",
    windowsHide: true,
  });
  if (copy.error || (copy.status ?? 16) > 7) {
    await rm(work, { recursive: true, force: true });
    throw copy.error ?? new Error(`robocopy.exe exited with code ${copy.status ?? 16}`);
  }

  const binaryRoot = path.join(nativeRoot, "bin");
  const localInitdb = path.join(binaryRoot, path.basename(initdb));
  const localPgCtl = path.join(binaryRoot, path.basename(pgCtl));
  const postgresPort = await availablePort();
  const migrator = "yu_browser_smoke_migrator";
  const runtime = "yu_browser_smoke_runtime";
  const databaseName = "yu_inventory_browser_test";
  const migratorPassword = randomBytes(24).toString("hex");
  const runtimePassword = randomBytes(24).toString("hex");
  const processEnvironment = {
    ...safeBaseEnvironment(),
    LC_MESSAGES: "C",
    PATH: `${binaryRoot};${safeBaseEnvironment().PATH ?? ""}`,
  };
  let started = false;

  try {
    await mkdir(data, { recursive: true });
    await writeFile(passwordFile, `${migratorPassword}\n`, { mode: 0o600 });
    run(localInitdb, [
      `--pgdata=${data}`,
      "--auth=scram-sha-256",
      `--username=${migrator}`,
      `--pwfile=${passwordFile}`,
      "--encoding=UTF8",
      "--locale=C",
    ], processEnvironment, work);
    await rm(passwordFile, { force: true });
    run(localPgCtl, ["-D", data, "-o", `-h 127.0.0.1 -p ${postgresPort}`, "-w", "start"], processEnvironment, work);
    started = true;

    const adminUrl = postgresUrl(migrator, migratorPassword, postgresPort, "postgres");
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create role ${runtime} login password '${runtimePassword}'`);
      await admin.query(`create database ${databaseName}`);
    } finally {
      await admin.end();
    }

    return {
      environment: {
        TEST_DATABASE_URL: postgresUrl(runtime, runtimePassword, postgresPort, databaseName),
        TEST_DATABASE_MIGRATOR_URL: postgresUrl(migrator, migratorPassword, postgresPort, databaseName),
      },
      async cleanup() {
        if (started) {
          run(localPgCtl, ["-D", data, "stop", "-m", "fast", "-w"], processEnvironment, work, false);
        }
        await rm(work, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (started) run(localPgCtl, ["-D", data, "stop", "-m", "fast", "-w"], processEnvironment, work, false);
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupSchemas(migratorUrl) {
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query('drop schema if exists "yu_migrations" cascade');
    await client.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await client.end();
  }
}

function runNode(arguments_, environment) {
  run(process.execPath, arguments_, environment, root);
}

function run(command, arguments_, environment, cwd, fail = true) {
  const result = spawnSync(command, arguments_, { cwd, env: environment, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (fail && result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with code ${result.status ?? 1}.`);
  }
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Production server did not become ready within 60 seconds.");
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  if (!child.pid) throw new Error("Production server has no process identifier.");

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    signalProcessGroup(child.pid, "SIGTERM");
  }
  if (await waitForExit(child, 5_000)) return;

  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.error) throw result.error;
  } else {
    signalProcessGroup(child.pid, "SIGKILL");
  }
  if (!(await waitForExit(child, 5_000))) {
    throw new Error(`Production server process tree ${child.pid} did not stop.`);
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function collectLog(stream, target) {
  stream?.on("data", (chunk) => {
    target.push(String(chunk));
    if (target.length > 500) target.splice(0, target.length - 500);
  });
}

function sanitizeLog(value) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]")
    .replaceAll(fixtureEnvironment.BROWSER_SMOKE_PASSWORD, "[redacted]")
    .replace(/(password|secret|token)=([^\s&]+)/gi, "$1=[redacted]");
}

function safeBaseEnvironment() {
  const allowed = [
    "APPDATA",
    "CI",
    "COMSPEC",
    "FORCE_COLOR",
    "GITHUB_ACTIONS",
    "HOME",
    "LOCALAPPDATA",
    "NO_COLOR",
    "NUMBER_OF_PROCESSORS",
    "PATH",
    "PATHEXT",
    "PLAYWRIGHT_BROWSERS_PATH",
    "PROCESSOR_ARCHITECTURE",
    "PROGRAMDATA",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TZ",
    "USERPROFILE",
    "WINDIR",
  ];
  return Object.fromEntries(
    allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
  );
}

function disabledExternalEnvironment() {
  return Object.fromEntries([
    "AUTH_ADMIN_BLOCKED",
    "AUTH_ADMIN_EMAIL",
    "AUTH_ADMIN_NAME",
    "AUTH_ADMIN_PASSWORD_HASH",
    "AUTH_ADMIN_PASSWORD_SALT",
    "AUTH_ADMIN_ROLE",
    "AUTH_BOOTSTRAP_TOKEN",
    "AUTH_PASSWORD_RESET_PUBLIC_ORIGIN",
    "AUTH_PASSWORD_RESET_WEBHOOK_SECRET",
    "AUTH_PASSWORD_RESET_WEBHOOK_URL",
    "DATABASE_ALLOW_UNVERIFIED_TLS",
    "DATABASE_DEPLOYMENT_ID",
    "DATABASE_MIGRATOR_URL",
    "DATABASE_TARGET",
    "DATABASE_URL",
    "DOCKFLOW_API_KEY",
    "DOCKFLOW_API_KEY_NEXT",
    "DOCKFLOW_TEST_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_WORKSPACE_DOMAIN",
    "ONE_C_FIXED_ASSETS_API_KEY",
    "TMC_PUSH_WORKER_INTERVAL_MS",
    "TRUSTED_CLIENT_IP_HEADER",
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    "WEB_PUSH_VAPID_PUBLIC_KEY",
    "WEB_PUSH_VAPID_SUBJECT",
    "YESSENOV_DIRECTORY_API_TOKEN",
    "YESSENOV_OIDC_CLIENT_ID",
    "YESSENOV_OIDC_CLIENT_SECRET",
    "YESSENOV_OIDC_REDIRECT_URI",
    "YU_INVENTORY_IMPORT_LEGACY_AUTH",
  ].map((key) => [key, ""]));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "unknown browser-smoke failure";
}

function cleanupResources() {
  cleanupPromise ??= (async () => {
    let cleanupFailure;
    if (server) {
      try {
        await stopProcess(server);
      } catch (error) {
        cleanupFailure ??= error;
        serverLog.push(`\n[cleanup] ${errorMessage(error)}\n`);
      }
    }
    if (database) {
      try {
        await database.cleanup();
      } catch (error) {
        cleanupFailure ??= error;
        serverLog.push(`\n[cleanup] ${errorMessage(error)}\n`);
      }
    }
    return cleanupFailure;
  })();
  return cleanupPromise;
}

async function persistFailureEvidence() {
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    path.join(artifactRoot, "server.log"),
    sanitizeLog(serverLog.join("")),
    { encoding: "utf8", mode: 0o600 },
  );
}

async function handleSignal(signal, exitCode) {
  failure ??= new Error(`Browser smoke interrupted by ${signal}.`);
  const hardStop = setTimeout(() => process.exit(exitCode), 15_000);
  try {
    const cleanupFailure = await cleanupResources();
    failure ??= cleanupFailure;
    await persistFailureEvidence();
  } finally {
    clearTimeout(hardStop);
    process.exit(exitCode);
  }
}

function postgresUrl(username, password, port, databaseName) {
  const url = new URL(`postgresql://127.0.0.1:${port}/${databaseName}`);
  url.username = username;
  url.password = password;
  return url.toString();
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const port = typeof address === "object" && address ? address.port : null;
      listener.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function assertWorkspacePath(target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Browser-smoke artifact directory must stay inside the workspace.");
  }
}
