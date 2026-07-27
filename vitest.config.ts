import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "tests/empty-server-only.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "lib/security/authorization.ts",
        "lib/security/credentials.ts",
        "lib/security/login-protection.ts",
        "lib/security/password-reset.ts",
        "lib/security/rate-limiter.ts",
        "lib/security/registration-protection.ts",
        "lib/security/session.ts",
        "lib/data-directory.ts",
        "app/api/auth/{forgot-password,login,logout,register,reset-password,session}/route.ts",
        "proxy.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 50,
        perFile: true,
      },
    },
  },
});
