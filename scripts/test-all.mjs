import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { getDatabaseTestFiles } from "./database-test-files.mjs";

const root = process.cwd();
const testDirectory = path.join(root, "tests");
const hasRuntimeDatabase = Boolean(process.env.TEST_DATABASE_URL);
const hasMigratorDatabase = Boolean(process.env.TEST_DATABASE_MIGRATOR_URL);

if (hasRuntimeDatabase !== hasMigratorDatabase) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL must be provided together.",
  );
}
if (process.env.CI && !hasRuntimeDatabase) {
  throw new Error("TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL are required in CI.");
}
const clientTests = new Set([
  "employee-items-tabs.test.ts",
  "room-service-requests.test.ts",
  "sidebar-navigation.test.ts",
]);
const allRootTests = readdirSync(testDirectory)
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

runNodeTests(
  allRootTests.filter((name) => !clientTests.has(name)),
  ["--conditions=react-server"],
);
runNodeTests([...clientTests].sort(), []);
run(
  process.execPath,
  [path.join(root, "node_modules/typescript/bin/tsc"), "--project", "tests/typecheck/tsconfig.components.json", "--pretty", "false"],
  { ...process.env, NODE_ENV: "test" },
);
run(
  process.execPath,
  [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.components.config.mts"],
  { ...process.env, NODE_ENV: "test" },
);

if (hasRuntimeDatabase) {
  for (const databaseTest of getDatabaseTestFiles(root)) {
    run(
      process.execPath,
      [path.join(root, "node_modules/vitest/vitest.mjs"), "run", databaseTest],
      {
        ...process.env,
        NODE_ENV: "test",
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"]
          .filter(Boolean)
          .join(" "),
      },
    );
  }
} else {
  console.warn(
    "PostgreSQL integration: SKIPPED (set TEST_DATABASE_URL and TEST_DATABASE_MIGRATOR_URL to run it).",
  );
}

console.log(
  `Test suite summary: server=ran, ui=ran, components=ran, database=${hasRuntimeDatabase ? "ran" : "SKIPPED"}.`,
);

function runNodeTests(files, extraArguments) {
  run(
    process.execPath,
    [
      "--import",
      "./scripts/node-userinfo-workaround.mjs",
      ...extraArguments,
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      ...files.map((name) => path.join("tests", name)),
    ],
    { ...process.env, NODE_ENV: "test" },
  );
}

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
