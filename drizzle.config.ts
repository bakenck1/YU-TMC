import { defineConfig } from "drizzle-kit";

export default defineConfig({
  casing: "snake_case",
  dialect: "postgresql",
  migrations: {
    prefix: "timestamp",
    schema: "yu_migrations",
    table: "__drizzle_migrations",
  },
  out: "./drizzle",
  schema: "./lib/db/schema.ts",
  strict: true,
  verbose: true,
});
