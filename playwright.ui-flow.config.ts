import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui-flow",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.YU_UI_CAPTURE_BASE_URL ?? "http://localhost:3000",
    ...devices["Desktop Chrome"],
    screenshot: "off",
    trace: "retain-on-failure",
  },
});
