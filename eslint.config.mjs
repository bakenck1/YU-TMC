import { defineConfig, globalIgnores } from "eslint/config";
import { builtinModules } from "node:module";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const nodeBuiltinImports = [
  ...new Set(
    builtinModules.flatMap((moduleName) => {
      const bareName = moduleName.replace(/^node:/, "");
      return [bareName, `node:${bareName}`];
    }),
  ),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/**/*.{js,jsx,ts,tsx}",
      "components/**/*.{js,jsx,ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "pg",
              message:
                "UI and HTTP entry points must use application services, not PostgreSQL directly.",
            },
            {
              name: "drizzle-orm",
              message:
                "UI and HTTP entry points must use application services, not Drizzle directly.",
            },
          ],
          patterns: [
            {
              group: [
                "pg/*",
                "drizzle-orm/*",
                "@/lib/db",
                "@/lib/db/*",
                "@/lib/server/persistence",
                "@/lib/server/persistence/*",
              ],
              message:
                "Import the server application facade instead of a persistence adapter.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "lib/application/**/*.{js,jsx,ts,tsx}",
      "lib/domain/**/*.{js,jsx,ts,tsx}",
      "lib/contracts/**/*.{js,jsx,ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeBuiltinImports.map((name) => ({
            name,
            message:
              "Domain and application code must stay independent of Node.js infrastructure.",
          })),
          patterns: [
            {
              group: [
                "next",
                "next/*",
                "react",
                "react/*",
                "pg",
                "pg/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "@/lib/db",
                "@/lib/db/*",
                "@/lib/server",
                "@/lib/server/*",
              ],
              message:
                "Domain and application code must stay independent of UI and infrastructure.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
