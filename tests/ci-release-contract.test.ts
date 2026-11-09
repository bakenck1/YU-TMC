import assert from "node:assert/strict";
import { mkdir,mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getDatabaseTestFiles } from "../scripts/database-test-files.mjs";

test("CI validates the documented release gates in dependency order", async () => {
  const { createRequire } = await import("node:module");
  const { load } = createRequire(import.meta.url)("js-yaml") as { load(text: string): { jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string,string> }>; env?: Record<string,string> }> } };
  const workflow = load(await readFile(".github/workflows/tests.yml", "utf8"));
  const job = workflow.jobs.tests;
  assert.ok(job);
  const commands = job.steps.map(step => step.run ?? "");
  const migrate = commands.findIndex(command => command.includes("npm run db:migrate"));
  const smoke = commands.findIndex(command => command.includes("npm run db:smoke"));
  const run = commands.findIndex(command => command.includes("npm run test:all"));
  assert.ok(migrate >= 0 && smoke > migrate && run > smoke);
  const env = { ...job.env, ...job.steps[run].env };
  assert.ok(env.TEST_DATABASE_URL);
  assert.ok(env.TEST_DATABASE_MIGRATOR_URL);
});

test("the database runner discovers nested suites and ignores support files and worktrees", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yu-test-discovery-"));
  try {
    for (const name of [
      "tests/database/z.test.ts",
      "tests/database/nested/a.test.ts",
      "tests/database/support/helper.ts",
      "tests/database/notes.test.ts.bak",
      ".codex-worktrees/other/tests/database/foreign.test.ts",
    ]) {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "");
    }
    assert.deepEqual(getDatabaseTestFiles(root), [
      path.join("tests", "database", "nested", "a.test.ts"),
      path.join("tests", "database", "z.test.ts"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("test runner requires paired database credentials and reports skipped coverage", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const credentials of [{ TEST_DATABASE_URL: "postgresql://unused/runtime", TEST_DATABASE_MIGRATOR_URL: "" }, { TEST_DATABASE_URL: "", TEST_DATABASE_MIGRATOR_URL: "postgresql://unused/migrator" }, { TEST_DATABASE_URL: "", TEST_DATABASE_MIGRATOR_URL: "", CI: "1" }]) {
    const result = spawnSync(process.execPath, ["scripts/test-all.mjs"], { encoding: "utf8", windowsHide: true, env: { ...process.env, CI: "", ...credentials } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL/);
  }
});
