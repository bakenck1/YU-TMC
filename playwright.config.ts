import { defineConfig, devices } from "@playwright/test";
import { E2E_DATA_DIRECTORY } from "./tests/e2e/environment";

const port = Number(process.env.YU_E2E_PORT ?? "3110");
const baseURL = `http://localhost:${port}`;
process.env.YU_E2E_DATA_DIRECTORY = E2E_DATA_DIRECTORY;

export default defineConfig({
  testDir: "./tests/e2e/specs",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never" }]],
  globalTeardown: "./tests/e2e/global-teardown.ts",
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `node tests/e2e/server.mjs --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      YU_DATA_DIRECTORY: E2E_DATA_DIRECTORY,
      SESSION_SECRET: "yu-inventory-e2e-session-secret-2026",
      AUTH_ADMIN_EMAIL: "",
      AUTH_ADMIN_NAME: "",
      AUTH_ADMIN_ROLE: "",
      AUTH_ADMIN_PASSWORD_HASH: "",
      AUTH_ADMIN_PASSWORD_SALT: "",
      AUTH_ADMIN_BLOCKED: "",
    },
  },
});
