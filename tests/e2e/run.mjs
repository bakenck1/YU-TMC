import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const lockFile = path.resolve(".next-e2e.lock");
const buildScript = path.resolve("tests", "e2e", "build.mjs");
const playwrightCli = path.resolve(
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);

const lock = acquireLock();
try {
  run(process.execPath, [buildScript]);
  run(process.execPath, [playwrightCli, "test"]);
} finally {
  releaseLock(lock);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`E2E command failed with exit code ${result.status ?? 1}.`);
  }
}

function acquireLock() {
  const token = randomUUID();
  let handle;
  try {
    handle = openSync(lockFile, "wx");
  } catch (error) {
    if (fileErrorCode(error) === "EEXIST") {
      throw new Error(
        "Another E2E run is using this working tree. If no run is active, remove the stale .next-e2e.lock file explicitly.",
      );
    }
    throw error;
  }

  try {
    writeFileSync(
      handle,
      JSON.stringify({ pid: process.pid, token }),
      "utf8",
    );
  } catch (error) {
    closeSync(handle);
    unlinkSync(lockFile);
    throw error;
  }
  return { handle, token };
}

function releaseLock(lock) {
  closeSync(lock.handle);
  let owner;
  try {
    owner = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") return;
    throw error;
  }
  if (
    owner &&
    typeof owner === "object" &&
    owner.token === lock.token
  ) {
    unlinkSync(lockFile);
  }
}

function fileErrorCode(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  return typeof error.code === "string" ? error.code : undefined;
}
