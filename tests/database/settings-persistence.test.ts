import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { DEFAULT_APP_SETTINGS } from "@/lib/app-settings";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { importLegacySettings } from "@/lib/db/settings-import";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { PostgresSettingsRepository } from "@/lib/server/persistence/postgres/postgres-settings-repository";

let migrationConfig: DatabaseConfig;
let runtimeConfig: DatabaseConfig;
let migrationPool: Pool;
let runtimePool: Pool;

describe("PostgreSQL settings persistence", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    runtimeConfig = readDatabaseConfig({ purpose: "runtime", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    migrationPool = createPostgresPool(migrationConfig, { max: 2 });
    runtimePool = createPostgresPool(runtimeConfig, { max: 2 });
  });

  beforeEach(async () => {
    await migrationPool.query(
      `update "yu_inventory"."settings"
          set payload = $1::jsonb,
              version = 1,
              updated_at = now()
        where id = 'global'`,
      [DEFAULT_APP_SETTINGS],
    );
  });

  afterAll(async () => {
    await runtimePool?.end();
    await migrationPool?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("creates exactly one default row and protects it from deletion", async () => {
    const repository = new PostgresSettingsRepository({
      pool: () => runtimePool,
    });

    await expect(repository.get()).resolves.toEqual(DEFAULT_APP_SETTINGS);
    await expect(
      runtimePool.query(
        `select count(*)::int as count from "yu_inventory"."settings"`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    const privileges = await runtimePool.query<{
      canInsert: boolean;
      canDelete: boolean;
    }>(
      `select
         has_table_privilege(current_user, 'yu_inventory.settings', 'INSERT') as "canInsert",
         has_table_privilege(current_user, 'yu_inventory.settings', 'DELETE') as "canDelete"`,
    );
    expect(privileges.rows[0]).toEqual({ canInsert: false, canDelete: false });

    await expect(
      runtimePool.query(
        `delete from "yu_inventory"."settings" where id = 'global'`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      migrationPool.query(
        `delete from "yu_inventory"."settings" where id = 'global'`,
      ),
    ).rejects.toMatchObject({ code: "55006" });
  });

  it("provides read-after-write across separate runtime pool clients", async () => {
    const firstPool = createPostgresPool(runtimeConfig, { max: 1 });
    const secondPool = createPostgresPool(runtimeConfig, { max: 1 });
    try {
      await expect(
        new PostgresSettingsRepository({ pool: () => firstPool }).update({
          organizationName: "Cross Connection Inventory",
        }),
      ).resolves.toMatchObject({
        organizationName: "Cross Connection Inventory",
      });
      await expect(
        new PostgresSettingsRepository({ pool: () => secondPool }).get(),
      ).resolves.toMatchObject({
        organizationName: "Cross Connection Inventory",
      });
    } finally {
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  });

  it("serializes concurrent updates instead of losing a write", async () => {
    const firstPool = createPostgresPool(runtimeConfig, { max: 1 });
    const secondPool = createPostgresPool(runtimeConfig, { max: 1 });
    try {
      const [first, second] = await Promise.all([
        new PostgresSettingsRepository({ pool: () => firstPool }).update({
          organizationName: "Concurrent First",
        }),
        new PostgresSettingsRepository({ pool: () => secondPool }).update({
          language: "en",
        }),
      ]);
      expect(first.organizationName).toBe("Concurrent First");
      expect(second.language).toBe("en");

      const final = await new PostgresSettingsRepository({
        pool: () => runtimePool,
      }).get();
      expect(final).toMatchObject({
        organizationName: "Concurrent First",
        language: "en",
      });
      await expect(
        migrationPool.query<{ version: number }>(
          `select version from "yu_inventory"."settings" where id = 'global'`,
        ),
      ).resolves.toMatchObject({ rows: [{ version: 3 }] });
    } finally {
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  });

  it("imports legacy settings once and leaves later explicit changes untouched", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yu-settings-"));
    const filename = path.join(directory, "settings.json");
    try {
      await writeFile(
        filename,
        JSON.stringify({
          ...DEFAULT_APP_SETTINGS,
          organizationName: "Legacy Inventory",
        }),
        "utf8",
      );
      await expect(
        importLegacySettings(migrationPool, { filename }),
      ).resolves.toBe("imported");
      await expect(
        importLegacySettings(migrationPool, { filename }),
      ).resolves.toBe("skipped");
      await expect(
        new PostgresSettingsRepository({ pool: () => runtimePool }).get(),
      ).resolves.toMatchObject({ organizationName: "Legacy Inventory" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const resetPool = createPostgresPool(config, { max: 1 });
  try {
    await resetPool.query('drop schema if exists "yu_migrations" cascade');
    await resetPool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await resetPool.end();
  }
}
