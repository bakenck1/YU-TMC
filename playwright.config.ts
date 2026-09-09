import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BROWSER_SMOKE_BASE_URL;
if (!baseURL) throw new Error("BROWSER_SMOKE_BASE_URL is required.");

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: ".artifacts/browser-smoke/results",
  reporter: [["line"]],
  use: {
    baseURL,
    locale: "ru-RU",
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
