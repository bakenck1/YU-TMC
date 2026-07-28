import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
const fontMocks = path.resolve("tests", "e2e", "google-font-mocks.cjs");
const databasePreparation = path.resolve(
  "scripts",
  "db",
  "prepare-e2e-database.ts",
);
const distDir = path.resolve(".next-e2e");
if (
  path.dirname(distDir) !== process.cwd() ||
  path.basename(distDir) !== ".next-e2e"
) {
  throw new Error(`Refusing to clean unsafe E2E build directory: ${distDir}`);
}
rmSync(distDir, { recursive: true, force: true });
const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontMocks,
    AUTH_ADMIN_EMAIL: "",
    AUTH_ADMIN_PASSWORD_HASH: "",
    AUTH_ADMIN_PASSWORD_SALT: "",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const databaseResult = spawnSync(
  process.execPath,
  ["--import", "tsx", databasePreparation],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
    stdio: "inherit",
  },
);
if (databaseResult.error) throw databaseResult.error;
process.exit(databaseResult.status ?? 1);
