import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { defineConfig } from "vitest/config";

const mutableEnvironment = process.env as Record<string, string | undefined>;
mutableEnvironment.NODE_ENV = "test";
loadEnvConfig(process.cwd(), false);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ["tests/database/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
