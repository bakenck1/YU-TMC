import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { getDatabaseTestFiles } from "../scripts/database-test-files.mjs";

test("CI validates the documented release gates in dependency order", async () => {
  const workflow = await readFile(".github/workflows/tests.yml", "utf8");
  const migrationIndex = workflow.indexOf("npm run db:migrate -- --target=test");
  const smokeIndex = workflow.indexOf("npm run db:smoke -- --target=test");
  const testsIndex = workflow.indexOf("npm run test:all");

  assert.ok(migrationIndex >= 0);
  assert.ok(smokeIndex > migrationIndex);
  assert.ok(testsIndex > smokeIndex);
  assert.match(workflow, /TEST_DATABASE_URL:/);
  assert.match(workflow, /TEST_DATABASE_MIGRATOR_URL:/);
  assert.match(workflow, /yu-inventory-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /npm run docs:check/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run ui:check/);
  assert.match(workflow, /npm run db:check/);
  assert.match(workflow, /npm run storybook:build/);
  assert.doesNotMatch(workflow, /docker (?:compose|build|run|exec)/);
});

test("direct deployment performs migration, settings import, and smoke checks before services start", async () => {
  const deploymentGuide = await readFile("deploy/README.md", "utf8");
  const appService = await readFile("deploy/systemd/yu-inventory.service", "utf8");
  const workerService = await readFile("deploy/systemd/yu-inventory-push-worker.service", "utf8");
  const migrationIndex = deploymentGuide.indexOf("npm run db:migrate -- --target=production");
  const importIndex = deploymentGuide.indexOf("npm run db:import-settings -- --target=production");
  const smokeIndex = deploymentGuide.indexOf("npm run db:smoke -- --target=production");

  assert.ok(migrationIndex >= 0);
  assert.ok(importIndex > migrationIndex);
  assert.ok(smokeIndex > importIndex);
  assert.match(deploymentGuide, /--source=\/secure\/path\/settings\.json/);
  assert.match(appService, /ExecStart=\/usr\/bin\/npm run start/);
  assert.match(appService, /Environment=HOSTNAME=127\.0\.0\.1/);
  assert.match(workerService, /ExecStart=\/usr\/bin\/npm run worker:tmc-push -- --loop/);
});

test("external development startup prepares the database before Next.js", async () => {
  const devScript = await readFile("scripts/dev.mjs", "utf8");
  const externalBranch = devScript.slice(devScript.lastIndexOf("if (configuredDatabaseUrl)"));
  const migrationIndex = externalBranch.indexOf('["run", "db:migrate"');
  const importIndex = externalBranch.indexOf('["run", "db:import-settings"');
  const smokeIndex = externalBranch.indexOf('["run", "db:smoke"');
  const nextIndex = externalBranch.indexOf('["run", "dev:next"]');

  assert.ok(migrationIndex >= 0);
  assert.ok(importIndex > migrationIndex);
  assert.ok(smokeIndex > importIndex);
  assert.ok(nextIndex > smokeIndex);
});

test("the database runner discovers every committed database test", () => {
  const expected = readdirSync(path.join(process.cwd(), "tests", "database"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => path.join("tests", "database", name));

  assert.deepEqual(getDatabaseTestFiles(process.cwd()), expected);
  assert.ok(expected.length > 0);
});

test("test runner requires paired database credentials and reports skipped coverage", async () => {
  const runner = await readFile("scripts/test-all.mjs", "utf8");
  assert.match(runner, /TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL must be provided together/);
  assert.match(runner, /required in CI/);
  assert.match(runner, /database=\$\{hasRuntimeDatabase \? "ran" : "SKIPPED"\}/);
});
