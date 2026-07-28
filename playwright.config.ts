import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { E2E_DATA_DIRECTORY } from "./tests/e2e/environment";

const mutableEnvironment = process.env as Record<string, string | undefined>;
const originalNodeEnvironment = mutableEnvironment.NODE_ENV;
mutableEnvironment.NODE_ENV = "test";
loadEnvConfig(process.cwd(), false);
if (originalNodeEnvironment === undefined) {
  delete mutableEnvironment.NODE_ENV;
} else {
  mutableEnvironment.NODE_ENV = originalNodeEnvironment;
}

const port = Number(process.env.YU_E2E_PORT ?? "3110");
const webhookPort = Number(process.env.YU_E2E_WEBHOOK_PORT ?? String(port + 1));
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
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.12" },
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
      AUTH_PASSWORD_RESET_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}/password-reset`,
      AUTH_PASSWORD_RESET_WEBHOOK_SECRET: "yu-e2e-reset-webhook-secret",
      YU_E2E_WEBHOOK_PORT: String(webhookPort),
      YU_INVENTORY_E2E_DATABASE_TARGET: "test",
    },
  },
});
