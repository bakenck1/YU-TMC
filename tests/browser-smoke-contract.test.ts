import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBrowserSmokeEnvironment } from "../scripts/browser-smoke-environment.mjs";
import { assertDisposableDatabasePair } from "../scripts/browser-smoke-safety.mjs";

test("browser smoke is a narrow production-build Chromium gate", async () => {
  const [manifestSource, config, runner, workflow, documentation] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("playwright.config.ts", "utf8"),
    readFile("scripts/browser-smoke.mjs", "utf8"),
    readFile(".github/workflows/tests.yml", "utf8"),
    readFile("docs/browser-smoke.md", "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.equal(manifest.scripts?.["test:browser-smoke"], "node scripts/browser-smoke.mjs");
  assert.ok(manifest.devDependencies?.["@playwright/test"]);
  assert.match(config, /name: "chromium"/);
  assert.match(config, /workers: 1/);
  assert.match(config, /retries: 0/);
  assert.match(config, /screenshot: "only-on-failure"/);
  assert.match(config, /trace: "off"/);
  assert.match(runner, /assertDisposableDatabasePair/);
  assert.match(runner, /createBrowserSmokeEnvironment\(process\.env\)/);
  assert.match(runner, /process\.once\(signal/);
  assert.match(runner, /cleanupResources/);
  assert.match(runner, /NEXT_DIST_DIR: "\.next-e2e"/);
  assert.match(runner, /node_modules\/next\/dist\/bin\/next", "build"/);
  assert.match(runner, /finally \{/);
  assert.match(workflow, /browser-smoke:/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(documentation, /Inventory Platform maintainers/);
  assert.match(documentation, /below 1%/);
});

test("browser smoke blanks dotenv integrations and drops unrelated inherited secrets", () => {
  const environment = createBrowserSmokeEnvironment({
    PATH: "safe-path",
    AUTH_ADMIN_EMAIL: "legacy-admin@example.test",
    GOOGLE_CLIENT_SECRET: "google-secret",
    ONE_C_FIXED_ASSETS_API_KEY: "one-c-secret",
    UNRELATED_SECRET: "must-not-be-inherited",
  });

  assert.equal(environment.PATH, "safe-path");
  assert.equal(environment.AUTH_ADMIN_EMAIL, "");
  assert.equal(environment.GOOGLE_CLIENT_SECRET, "");
  assert.equal(environment.ONE_C_FIXED_ASSETS_API_KEY, "");
  assert.equal(environment.UNRELATED_SECRET, undefined);
});

test("browser smoke accepts only an explicitly acknowledged disposable database pair", () => {
  const runtime = "postgresql://runtime:secret@127.0.0.1:55434/isolated_test";
  const migrator = "postgresql://migrator:secret@127.0.0.1:55434/isolated_test";

  assert.doesNotThrow(() => assertDisposableDatabasePair(
    runtime,
    migrator,
    "reset:127.0.0.1:55434/isolated_test",
  ));
  assert.throws(
    () => assertDisposableDatabasePair(runtime, migrator, undefined),
    /RESET_CONFIRMATION/,
  );
  assert.throws(
    () => assertDisposableDatabasePair(
      runtime,
      "postgresql://migrator:secret@127.0.0.1:5432/isolated_test",
      "reset:127.0.0.1:5432/isolated_test",
    ),
    /same loopback database/,
  );
  assert.throws(
    () => assertDisposableDatabasePair(runtime, runtime, "reset:127.0.0.1:55434/isolated_test"),
    /different roles/,
  );
  assert.throws(
    () => assertDisposableDatabasePair(
      runtime,
      "postgresql://migrator:secret@database.internal:55434/isolated_test",
      "reset:database.internal:55434/isolated_test",
    ),
    /loopback PostgreSQL/,
  );
});
