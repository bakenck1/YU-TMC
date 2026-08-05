import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSessionToken,
  isSessionConfigured,
  resetSessionStateForTests,
  verifySessionToken,
} from "../lib/security/session";

test("local session secret enables sign-in without SESSION_SECRET", () => {
  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousDataDirectory = process.env.YU_DATA_DIRECTORY;
  const previousNodeEnv = process.env.NODE_ENV;
  const temporaryDataDirectory = mkdtempSync(
    path.join(tmpdir(), "yu-inventory-session-"),
  );

  try {
    process.env.NODE_ENV = "test";
    Reflect.deleteProperty(process.env, "SESSION_SECRET");
    process.env.YU_DATA_DIRECTORY = temporaryDataDirectory;
    resetSessionStateForTests();

    assert.equal(isSessionConfigured(), true);
    assert.equal(existsSync(path.join(temporaryDataDirectory, "session-secret")), true);

    const token = createSessionToken({
      email: "admin@yu.edu.kz",
      name: "Administrator",
      role: "admin",
    });
    assert.equal(verifySessionToken(token)?.sub, "admin@yu.edu.kz");
  } finally {
    if (previousSessionSecret === undefined) {
      Reflect.deleteProperty(process.env, "SESSION_SECRET");
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
    if (previousDataDirectory === undefined) {
      Reflect.deleteProperty(process.env, "YU_DATA_DIRECTORY");
    } else {
      process.env.YU_DATA_DIRECTORY = previousDataDirectory;
    }
    resetSessionStateForTests();
    if (previousNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    rmSync(temporaryDataDirectory, { recursive: true, force: true });
  }
});
