import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("the deployment CLI creates a runtime configuration without migration credentials and blocks dotenv fallback", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "yu-runtime-env-"));
  try {
    const source = path.join(directory, ".env.local"), destination = path.join(directory, ".env.production.local");
    const configuration = [
      "# Production configuration", "DATABASE_URL=postgresql://runtime@example.test/inventory",
      "DATABASE_MIGRATOR_URL=postgresql://schema-owner@example.test/inventory",
      "  export TEST_DATABASE_MIGRATOR_URL = postgres://test-owner@example.test/inventory_test",
      "SESSION_SECRET=runtime-value", "APP_PUBLIC_ORIGIN=https://inventory.example.test",
      "DATABASE_SSL_CA=certificate\\nlines", "WA_SESSION=otinish", "",
    ].join("\r\n");
    writeFileSync(source, configuration);
    const result = spawnSync(process.execPath, [path.resolve("deploy/prepare-runtime-env.mjs"), source, destination], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    const runtime = readFileSync(destination, "utf8");
    assert.ok(!runtime.includes("schema-owner") && !runtime.includes("test-owner"));
    assert.ok(runtime.includes("DATABASE_URL=postgresql://runtime@example.test/inventory"));
    assert.ok(runtime.includes("DATABASE_SSL_CA=certificate\\nlines"));
    assert.ok(runtime.includes("WA_SESSION=otinish"));
    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    delete environment.DATABASE_MIGRATOR_URL;
    delete environment.TEST_DATABASE_MIGRATOR_URL;
    delete environment.DATABASE_URL;
    const next = spawnSync(process.execPath, ["--eval", `
      const { loadEnvConfig } = require('@next/env');
      loadEnvConfig(process.argv[1], false);
      if (process.env.DATABASE_MIGRATOR_URL !== '' || process.env.TEST_DATABASE_MIGRATOR_URL !== ''
        || process.env.DATABASE_URL !== 'postgresql://runtime@example.test/inventory') process.exit(1);
    `, directory], { encoding: "utf8", env: environment });
    assert.equal(next.status, 0, next.stderr);
    assert.equal(readFileSync(source, "utf8"), configuration);
    assert.deepEqual(readdirSync(directory).sort(), [".env.local", ".env.production.local"]);
    const repeated = spawnSync(process.execPath, [path.resolve("deploy/prepare-runtime-env.mjs"), source, destination], { encoding: "utf8" });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(readFileSync(destination, "utf8"), runtime);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the runtime CLI rejects overwriting the full migration configuration", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "yu-runtime-env-"));
  try {
    const source = path.join(directory, "full.env"), configuration = "DATABASE_MIGRATOR_URL=private-value\n";
    writeFileSync(source, configuration);
    const result = spawnSync(process.execPath, [path.resolve("deploy/prepare-runtime-env.mjs"), source, source], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Source and destination must differ/u);
    assert.equal(readFileSync(source, "utf8"), configuration);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a multiline migration credential is rejected without exposing its continuation or replacing runtime config", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "yu-runtime-env-"));
  try {
    const source = path.join(directory, "full.env"), destination = path.join(directory, "runtime.env");
    for (const continuation of ["password=private-value", "private-value"]) {
      writeFileSync(source, `DATABASE_URL=postgresql://runtime@example.test/inventory\nDATABASE_MIGRATOR_URL="postgresql://schema-owner:\n${continuation}@example.test/inventory"\n`);
      writeFileSync(destination, "previous-runtime-config\n");
      const result = spawnSync(process.execPath, [path.resolve("deploy/prepare-runtime-env.mjs"), source, destination], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.ok(!result.stdout.includes("private-value") && !result.stderr.includes("private-value"));
      assert.equal(readFileSync(destination, "utf8"), "previous-runtime-config\n");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
