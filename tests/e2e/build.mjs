import { spawnSync } from "node:child_process";
import path from "node:path";

const nextCli = path.resolve("node_modules", "next", "dist", "bin", "next");
const fontMocks = path.resolve("tests", "e2e", "google-font-mocks.cjs");
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
process.exit(result.status ?? 1);
