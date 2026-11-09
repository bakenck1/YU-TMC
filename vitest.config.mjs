import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
    conditions: ["react-server", "node", "import", "default"],
  },
  test: {
    environment: "node",
    include: ["tests/database/**/*.test.ts"],
    // Database suites rebuild the same test schema. This also makes a direct
    // Vitest invocation safe, rather than relying only on the CLI runner loop.
    fileParallelism: false,
  },
});
