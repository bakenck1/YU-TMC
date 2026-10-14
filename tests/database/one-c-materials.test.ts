import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { materialIdentityKey, type OneCMaterial, type OneCMaterialsSnapshot } from "@/lib/contracts/one-c-materials";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { PostgresOneCMaterialsRepository } from "@/lib/server/persistence/postgres/postgres-one-c-materials-repository";

let migrationConfig: DatabaseConfig;
let migrationPool: Pool;
let runtimePool: Pool;
let repository: PostgresOneCMaterialsRepository;
const material: OneCMaterial = {
  externalId: "eba5b834-db3b-41f0-a26e-7cc25579bdd7", code: "00000006135", name: "Принтер",
  warehouseExternalId: null, warehouseCode: "0001", warehouseName: "Основной склад",
  inventoryNumber: "1350/1444", barcode: null, unit: "шт", quantity: "1", unitPrice: "66784.48", currency: "KZT",
};
const firstDate = "2026-10-14T01:00:00.000Z";
const secondDate = "2026-10-15T01:00:00.000Z";
const snapshot = (materials = [material], snapshotAt = firstDate): OneCMaterialsSnapshot => ({ snapshotAt, materials });
const metadata = (source = randomUUID()) => ({
  sourceSha256: createHash("sha256").update(source).digest("hex"), requestId: randomUUID(), sourceFilename: "materials.xml",
});
const count = async (table: string) => (await runtimePool.query<{ count: number }>(`select count(*)::int count from "yu_inventory"."${table}"`)).rows[0].count;

describe("PostgreSQL separate 1C materials inbox", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    migrationPool = createPostgresPool(migrationConfig, { max: 2 });
    runtimePool = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "test" }), { max: 2 });
    repository = new PostgresOneCMaterialsRepository(runtimePool);
  });
  beforeEach(async () => {
    await migrationPool.query('truncate "yu_inventory"."one_c_material_inbox", "yu_inventory"."one_c_material_import_batch_rows", "yu_inventory"."one_c_material_import_batches"');
  });
  afterAll(async () => {
    await runtimePool?.end();
    await migrationPool?.end();
    await resetSchemas(migrationConfig);
  });

  it("grants runtime upsert privileges and protects immutable source rows", async () => {
    const result = await repository.saveSnapshot(snapshot(), metadata());
    for (const table of ["one_c_material_inbox", "one_c_material_import_batches", "one_c_material_import_batch_rows"]) {
      const grants = (await runtimePool.query<{ can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }>(
        "select has_table_privilege(current_user,$1,'SELECT') can_select,has_table_privilege(current_user,$1,'INSERT') can_insert,has_table_privilege(current_user,$1,'UPDATE') can_update,has_table_privilege(current_user,$1,'DELETE') can_delete",
        [`yu_inventory.${table}`],
      )).rows[0];
      expect(grants).toEqual({ can_select: true, can_insert: true, can_update: true, can_delete: false });
    }
    await expect(runtimePool.query('update "yu_inventory"."one_c_material_import_batch_rows" set payload=$2::jsonb where batch_id=$1', [result.batchId, '{}'])).rejects.toThrow(/immutable/);
    await expect(runtimePool.query('update "yu_inventory"."one_c_material_import_batches" set source_filename=$2 where id=$1', [result.batchId, "changed.xml"])).rejects.toThrow(/immutable/);
  });

  it("keeps one material's prices separate by warehouse and never changes fixed assets or Inventory", async () => {
    const initialAssets = await count("one_c_fixed_asset_inbox");
    const initialItems = await count("items");
    const result = await repository.saveSnapshot(snapshot([material, { ...material, warehouseCode: "0002", warehouseName: "Второй", unitPrice: "99999.99", quantity: "3" }]), metadata());
    expect(result).toMatchObject({ created: 2, updated: 0, unchanged: 0, replayed: false });
    const rows = await runtimePool.query<{ material_code: string; warehouse_key: string; quantity: string; unit_price: string }>('select material_code,warehouse_key,quantity::text,unit_price::text from "yu_inventory"."one_c_material_inbox" order by warehouse_key');
    expect(rows.rows).toEqual([
      { material_code: "00000006135", warehouse_key: "code:0001", quantity: "1.000", unit_price: "66784.48" },
      { material_code: "00000006135", warehouse_key: "code:0002", quantity: "3.000", unit_price: "99999.99" },
    ]);
    expect(await count("one_c_fixed_asset_inbox")).toBe(initialAssets);
    expect(await count("items")).toBe(initialItems);
  });

  it("keeps null price distinct from zero and exact signed decimal balances", async () => {
    await repository.saveSnapshot(snapshot([
      { ...material, externalId: null, code: "zero", quantity: "0", unitPrice: "0" },
      { ...material, externalId: null, code: "missing", quantity: "-123.456", unitPrice: null },
      { ...material, externalId: null, code: "exact", quantity: "999999999999999.999", unitPrice: "9999999999999999.99" },
    ]), metadata());
    const rows = await runtimePool.query('select material_code,quantity::text,unit_price::text from "yu_inventory"."one_c_material_inbox" order by material_code');
    expect(rows.rows).toEqual([
      { material_code: "exact", quantity: "999999999999999.999", unit_price: "9999999999999999.99" },
      { material_code: "missing", quantity: "-123.456", unit_price: null },
      { material_code: "zero", quantity: "0.000", unit_price: "0.00" },
    ]);
  });

  it("replays an accepted XML without reverting balances from a newer snapshot", async () => {
    const originalMetadata = metadata();
    const first = await repository.saveSnapshot(snapshot(), originalMetadata);
    await repository.saveSnapshot(snapshot([{ ...material, quantity: "4" }], secondDate), metadata());
    const repeated = await repository.saveSnapshot(snapshot(), { ...originalMetadata, requestId: randomUUID() });
    expect(repeated).toEqual({ created: 0, updated: 0, unchanged: 1, batchId: first.batchId, replayed: true });
    expect((await runtimePool.query('select quantity::text from "yu_inventory"."one_c_material_inbox"')).rows[0].quantity).toBe("4.000");
    expect(await count("one_c_material_import_batches")).toBe(2);
  });

  it("accepts changed values only on newer snapshots and distinguishes changed versus unchanged", async () => {
    await repository.saveSnapshot(snapshot([material, { ...material, externalId: null, code: "002" }]), metadata());
    const result = await repository.saveSnapshot(snapshot([{ ...material, quantity: "0" }, { ...material, externalId: null, code: "002" }], secondDate), metadata());
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const rows = await runtimePool.query('select source_snapshot_at::text from "yu_inventory"."one_c_material_inbox"');
    expect(rows.rows.every(row => row.source_snapshot_at.startsWith("2026-10-15"))).toBe(true);
  });

  it("rejects stale new XML and competing values at an equal snapshot date atomically", async () => {
    await repository.saveSnapshot(snapshot(), metadata());
    await expect(repository.saveSnapshot(snapshot([{ ...material, quantity: "2" }]), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    await expect(repository.saveSnapshot(snapshot([material], "2026-10-13T01:00:00Z"), metadata())).rejects.toMatchObject({ code: "stale_snapshot" });
    expect(await count("one_c_material_import_batches")).toBe(1);
    expect((await runtimePool.query('select quantity::text from "yu_inventory"."one_c_material_inbox"')).rows[0].quantity).toBe("1.000");
  });

  it("rejects GUID contradictions, duplicate keys, and reused hashes with other payloads", async () => {
    const original = metadata();
    await repository.saveSnapshot(snapshot(), original);
    await expect(repository.saveSnapshot(snapshot([{ ...material, externalId: randomUUID() }], secondDate), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    await expect(repository.saveSnapshot(snapshot([material, material], secondDate), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    await expect(repository.saveSnapshot(snapshot([{ ...material, quantity: "2" }]), original)).rejects.toMatchObject({ code: "snapshot_conflict" });
    expect(await count("one_c_material_import_batches")).toBe(1);
    expect(await count("one_c_material_inbox")).toBe(1);
  });

  it("keeps known GUID identity when a later packet omits GUID and rejects contradictory codes", async () => {
    const warehouseGuid = randomUUID();
    await repository.saveSnapshot(snapshot([{ ...material, warehouseExternalId: warehouseGuid }]), metadata());
    await repository.saveSnapshot(snapshot([{ ...material, externalId: null }], secondDate), metadata());
    const row = (await runtimePool.query('select material_external_id::text,warehouse_external_id::text from "yu_inventory"."one_c_material_inbox"')).rows[0];
    expect(row).toEqual({ material_external_id: material.externalId, warehouse_external_id: warehouseGuid });
    const nextDate = "2026-10-16T01:00:00Z";
    await expect(repository.saveSnapshot(snapshot([{ ...material, externalId: randomUUID() }], nextDate), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    await expect(repository.saveSnapshot(snapshot([{ ...material, code: "other-code" }], nextDate), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    await expect(repository.saveSnapshot(snapshot([{ ...material, warehouseCode: "other-warehouse", warehouseExternalId: warehouseGuid }], nextDate), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    await expect(repository.saveSnapshot(snapshot([material, { ...material, code: "other-code" }], nextDate), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    expect(await count("one_c_material_inbox")).toBe(1);
  });

  it("rolls back all rows if one row conflicts and retains balances omitted from later files", async () => {
    await repository.saveSnapshot(snapshot(), metadata());
    await expect(repository.saveSnapshot(snapshot([{ ...material, externalId: null, code: "new" }, { ...material, quantity: "2" }]), metadata())).rejects.toMatchObject({ code: "snapshot_conflict" });
    expect(await count("one_c_material_inbox")).toBe(1);
    await repository.saveSnapshot(snapshot([{ ...material, externalId: null, code: "new" }], secondDate), metadata());
    expect(await count("one_c_material_inbox")).toBe(2);
    expect((await runtimePool.query('select quantity::text from "yu_inventory"."one_c_material_inbox" where row_key=$1', [materialIdentityKey(material)])).rows[0].quantity).toBe("1.000");
  });

  it("fails quickly on concurrent imports without holding an extra lease connection", async () => {
    const client = await runtimePool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,731005))", ["yu-inventory:one-c-materials:v1"]);
      await expect(repository.saveSnapshot(snapshot(), metadata())).rejects.toMatchObject({ code: "import_in_progress" });
      expect(await count("one_c_material_inbox")).toBe(0);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("works with a runtime pool of one connection", async () => {
    const singlePool = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "test" }), { max: 1 });
    try {
      const result = await new PostgresOneCMaterialsRepository(singlePool).saveSnapshot(snapshot(), metadata());
      expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    } finally {
      await singlePool.end();
    }
  });

  it("rolls back source snapshots and balances when a statement exceeds its deadline", async () => {
    await migrationPool.query(`create function "yu_inventory"."slow_material_test"() returns trigger language plpgsql as $$ begin perform pg_sleep(0.1); return new; end $$`);
    await migrationPool.query('create trigger slow_material_test before insert on "yu_inventory"."one_c_material_inbox" for each row execute function "yu_inventory"."slow_material_test"()');
    try {
      await expect(new PostgresOneCMaterialsRepository(runtimePool, { statementTimeoutMs: 1_000, transactionTimeoutMs: 80 }).saveSnapshot(snapshot(), metadata())).rejects.toMatchObject({ code: "import_timeout" });
      expect(await count("one_c_material_inbox")).toBe(0);
      expect(await count("one_c_material_import_batches")).toBe(0);
    } finally {
      await migrationPool.query('drop trigger slow_material_test on "yu_inventory"."one_c_material_inbox"');
      await migrationPool.query('drop function "yu_inventory"."slow_material_test"()');
    }
  });

  it("overrides the pool's client query timeout for a supported longer import", async () => {
    const shortPool = createPostgresPool({ ...readDatabaseConfig({ purpose: "runtime", target: "test" }), statementTimeoutMs: 50 }, { max: 1 });
    await migrationPool.query(`create function "yu_inventory"."slow_material_test"() returns trigger language plpgsql as $$ begin perform pg_sleep(0.2); return new; end $$`);
    await migrationPool.query('create trigger slow_material_test before insert on "yu_inventory"."one_c_material_inbox" for each row execute function "yu_inventory"."slow_material_test"()');
    try {
      const result = await new PostgresOneCMaterialsRepository(shortPool, { statementTimeoutMs: 1_500, transactionTimeoutMs: 3_000 }).saveSnapshot(snapshot(), metadata());
      expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
      expect(await count("one_c_material_inbox")).toBe(1);
    } finally {
      await shortPool.end();
      await migrationPool.query('drop trigger slow_material_test on "yu_inventory"."one_c_material_inbox"');
      await migrationPool.query('drop function "yu_inventory"."slow_material_test"()');
    }
  });

  it("imports 50,000 rows in one transaction without per-row SQL", async () => {
    const records = Array.from({ length: 50_000 }, (_, index) => ({ ...material, externalId: null, code: String(index).padStart(10, "0") }));
    const result = await repository.saveSnapshot(snapshot(records), metadata());
    expect(result).toMatchObject({ created: 50_000, updated: 0, unchanged: 0 });
    expect(await count("one_c_material_inbox")).toBe(50_000);
    expect(await count("one_c_material_import_batch_rows")).toBe(50_000);
  }, 120_000);
});

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(config, { max: 1 });
  try { await pool.query('drop schema if exists "yu_migrations" cascade'); await pool.query('drop schema if exists "yu_inventory" cascade'); }
  finally { await pool.end(); }
}
