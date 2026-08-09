import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const testDirectory = path.join(root, "tests");
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

if (process.env.TEST_DATABASE_URL) {
  for (const databaseTest of [
    "tests/database/persistent-users.test.ts",
    "tests/database/tmc-operation-migration.test.ts",
    "tests/database/tmc-operation-repositories.test.ts",
    "tests/database/tmc-transfer-request-transactions.test.ts",
    "tests/database/web-push-repositories.test.ts",
  ]) {
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
} else if (process.env.CI) {
  throw new Error("TEST_DATABASE_URL is required in CI");
} else {
  console.warn("Skipping PostgreSQL integration test: TEST_DATABASE_URL is not set.");
}

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
