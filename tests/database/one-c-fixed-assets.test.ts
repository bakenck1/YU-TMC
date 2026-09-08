import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { OneCFixedAssetImportService } from "@/lib/application/services/one-c-fixed-asset-import-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { oneCFixedAssetPayload, type OneCFixedAsset } from "@/lib/server/integrations/one-c-fixed-assets";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import { createOneCFixedAssetsPostHandler } from "@/lib/server/http/one-c-fixed-assets-handler";

let migrationConfig: DatabaseConfig;
let runtimeConfig: DatabaseConfig;
let migrationPool: Pool;
let runtimePool: Pool;

const asset: OneCFixedAsset = {
  externalId: "eba5b834-db3b-41f0-a26e-7cc25579bdd7", code: "0001", inventoryNumber: null,
  barcode: null, name: "Компьютер", category: null, location: null, status: "Принято к учёту",
  responsibleName: null, responsibleExternalId: null, quantity: 1, residualCost: 100, acceptedAt: null, updatedAt: null,
};

describe("PostgreSQL 1C fixed-asset inbox", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    runtimeConfig = readDatabaseConfig({ purpose: "runtime", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    migrationPool = createPostgresPool(migrationConfig, { max: 2 });
    runtimePool = createPostgresPool(runtimeConfig, { max: 4 });
  });
  beforeEach(async () => { await migrationPool.query('truncate table "yu_inventory"."one_c_fixed_asset_inbox"'); });
  afterAll(async () => {
    await runtimePool?.end(); await migrationPool?.end(); await closeDatabase(); await resetSchemas(migrationConfig);
  });

  it("declares the migrated table contract and grants runtime write access", async () => {
    const columns = await migrationPool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'yu_inventory' and table_name = 'one_c_fixed_asset_inbox' order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(["external_id", "payload_hash", "payload", "received_at", "updated_at"]);
    const grants = await runtimePool.query<{ canSelect: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean }>(
      `select has_table_privilege(current_user, 'yu_inventory.one_c_fixed_asset_inbox', 'SELECT') as "canSelect",
              has_table_privilege(current_user, 'yu_inventory.one_c_fixed_asset_inbox', 'INSERT') as "canInsert",
              has_table_privilege(current_user, 'yu_inventory.one_c_fixed_asset_inbox', 'UPDATE') as "canUpdate",
              has_table_privilege(current_user, 'yu_inventory.one_c_fixed_asset_inbox', 'DELETE') as "canDelete"`,
    );
    expect(grants.rows[0]).toEqual({ canSelect: true, canInsert: true, canUpdate: true, canDelete: false });
    await expect(migrationPool.query<{ exists: boolean }>(
      `select exists(select 1 from pg_constraint where conname = 'one_c_fixed_asset_inbox_payload_hash_check') as exists`,
    )).resolves.toMatchObject({ rows: [{ exists: true }] });
  });

  it("holds the per-key import lease across independent pool clients", async () => {
    const first = new PostgresOneCFixedAssetRepository(runtimePool);
    const second = new PostgresOneCFixedAssetRepository(runtimePool);
    const lease = await first.tryAcquireLease("same-key-digest");
    expect(lease).not.toBeNull();
    await expect(second.tryAcquireLease("same-key-digest")).resolves.toBeNull();
    await lease?.release();
    const next = await second.tryAcquireLease("same-key-digest");
    expect(next).not.toBeNull();
    await next?.release();
  });

  it("classifies concurrent create, unchanged replay, and update without a pre-select race", async () => {
    const first = new PostgresOneCFixedAssetRepository(runtimePool);
    const second = new PostgresOneCFixedAssetRepository(runtimePool);
    const concurrent = await Promise.all([first.saveBatch([asset]), second.saveBatch([asset])]);
    expect(concurrent).toContainEqual({ created: 1, updated: 0, unchanged: 0 });
    expect(concurrent).toContainEqual({ created: 0, updated: 0, unchanged: 1 });
    await expect(first.saveBatch([{ ...asset, residualCost: 90 }])).resolves.toEqual({ created: 0, updated: 1, unchanged: 0 });
    const stored = await runtimePool.query<{ payload_hash: string; payload: OneCFixedAsset }>(
      'select payload_hash, payload from "yu_inventory"."one_c_fixed_asset_inbox" where external_id = $1', [asset.externalId],
    );
    expect(stored.rows[0]?.payload.residualCost).toBe(90);
    expect(stored.rows[0]?.payload_hash).toBe(oneCFixedAssetPayload({ ...asset, residualCost: 90 }).hash);
  });

  it("rolls the entire batch back when a later record cannot be serialized", async () => {
    const invalid = { ...asset, externalId: "03572fab-9e95-41ea-9a1b-002590861d2e", quantity: BigInt(1) } as unknown as OneCFixedAsset;
    await expect(new PostgresOneCFixedAssetRepository(runtimePool).saveBatch([asset, invalid])).rejects.toThrow();
    await expect(runtimePool.query<{ count: number }>('select count(*)::int as count from "yu_inventory"."one_c_fixed_asset_inbox"')).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("cancels and rolls back an import that exceeds the whole transaction deadline", async () => {
    await migrationPool.query(`create function "yu_inventory"."slow_one_c_import"() returns trigger language plpgsql as $$ begin perform pg_sleep(0.1); return new; end $$`);
    await migrationPool.query(`create trigger "slow_one_c_import" before insert on "yu_inventory"."one_c_fixed_asset_inbox" for each row execute function "yu_inventory"."slow_one_c_import"()`);
    try {
      const repository = new PostgresOneCFixedAssetRepository(runtimePool, { statementTimeoutMs: 1_000, transactionTimeoutMs: 50 });
      const response = await createOneCFixedAssetsPostHandler({
        service: new OneCFixedAssetImportService(repository), apiKey: () => "database-test-key", logFailure: () => undefined,
      })(new Request("https://inventory.example/api/integrations/1c/fixed-assets", {
        method: "POST", headers: { authorization: "Bearer database-test-key", "content-type": "application/xml" },
        body: `<FixedAssets><FixedAsset><GUID>${asset.externalId}</GUID><Name>${asset.name}</Name></FixedAsset></FixedAssets>`,
      }));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: "import_timeout" });
      await expect(runtimePool.query<{ count: number }>('select count(*)::int as count from "yu_inventory"."one_c_fixed_asset_inbox"')).resolves.toMatchObject({ rows: [{ count: 0 }] });
    } finally {
      await migrationPool.query('drop trigger if exists "slow_one_c_import" on "yu_inventory"."one_c_fixed_asset_inbox"');
      await migrationPool.query('drop function if exists "yu_inventory"."slow_one_c_import"()');
    }
  });
});

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(config, { max: 1 });
  try { await pool.query('drop schema if exists "yu_migrations" cascade'); await pool.query('drop schema if exists "yu_inventory" cascade'); }
  finally { await pool.end(); }
}
