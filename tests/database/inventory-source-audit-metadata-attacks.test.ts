import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import * as XLSX from "xlsx";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { uploadMaterialSnapshot } from "@/lib/server/material-snapshot-service";
import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";

let migrationConfig: DatabaseConfig;
let migrationPool: Pool;
let runtimePool: Pool;

describe("inventory audit metadata attacks against PostgreSQL", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    migrationPool = createPostgresPool(migrationConfig, { max: 2 });
    runtimePool = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "test" }), { max: 4 });
  });
  afterAll(async () => {
    await runtimePool?.end(); await migrationPool?.end(); await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("invalidates saved missing evidence when a new GUID link changes a later dry-run without bumping the item version", async () => {
    const fixture = await createFixture();
    const service = new OneCReconciliationService(runtimePool);
    const initial = await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(initial.data.find((row) => row.itemId === fixture.itemId)?.source).toBeNull();
    expect(initial.run.inventory.stale).toBe(false);
    // Publication inserts this link without updating items.version.
    await runtimePool.query(`insert into "yu_inventory"."item_one_c_links"
      (external_id,item_id,source_code,linked_by,link_method,last_batch_id,last_payload_hash)
      values($1,$2,'0001',$3,'manual',$4,$5)`,
    [fixture.externalId, fixture.itemId, fixture.userId, fixture.batchId, fixture.payloadHash]);
    const afterLink = await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(afterLink.run.counts).toEqual(initial.run.counts);
    expect(afterLink.data.find((row) => row.itemId === fixture.itemId)?.source).toBeNull();
    const currentBatch = await service.getBatch(fixture.batchId);
    await service.analyzeBatch(fixture.batchId, { version: Number(currentBatch.version) });
    const repeated = await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(repeated.data.find((row) => row.itemId === fixture.itemId)?.source).toBe("1c");
    expect(repeated.data.find((row) => row.itemId === fixture.itemId)?.oneC[0].matchedBy).toContain("guid");
    expect(afterLink.run.inventory.stale).toBe(true);
    expect(afterLink.run.inventory.changed).toBe(0);
    expect(afterLink.run.inventory.linksChanged).toBe(true);
  });

  it("preserves the saved total and reports every removal when no live cards remain", async () => {
    const fixture = await createFixture();
    const service = new OneCReconciliationService(runtimePool);
    const initial = await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    const savedTotal = Number(initial.run.counts.total);
    expect(savedTotal).toBeGreaterThan(0);
    await runtimePool.query(`update "yu_inventory"."items" set archived_at=now(),archived_by=$1,version=version+1 where archived_at is null`, [fixture.userId]);
    const afterRemoval = await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(afterRemoval.run.counts).toEqual(initial.run.counts);
    expect(afterRemoval.run.inventory).toMatchObject({
      currentTotal: 0, currentActive: 0, currentQuantity: 0, currentActiveQuantity: 0,
      added: 0, removed: savedTotal, changed: 0, stale: true,
    });
    expect(afterRemoval.total).toBe(savedTotal);
    expect(afterRemoval.data.length).toBe(savedTotal);
  });
});

async function createFixture() {
  const userId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), itemId = randomUUID(), externalId = randomUUID();
  await runtimePool.query(`insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at)
    values($1,$2,$3,'Audit metadata admin','admin',now(),now())`, [userId, `metadata-${userId.slice(0, 8)}`, `${userId}@example.test`]);
  await runtimePool.query(`insert into "yu_inventory"."buildings"(id,name,name_key,address,address_key,created_by,updated_by)
    values($1,'Metadata building',$2,'Metadata address',$2,$3,$3)`, [buildingId, `metadata-${buildingId}`, userId]);
  await runtimePool.query(`insert into "yu_inventory"."rooms"(id,building_id,designation,designation_key,floor_number,created_by,updated_by)
    values($1,$2,'101',$3,1,$4,$4)`, [roomId, buildingId, `metadata-${roomId}`, userId]);
  const inventoryNumber = `TMP-METADATA-${itemId.slice(0, 8)}`;
  await runtimePool.query(`insert into "yu_inventory"."items"
    (id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
    values($1,'Скамья',1,100,$2,'official',$3::text,lower($3::text),$4,$4)`, [itemId, roomId, inventoryNumber, userId]);
  const header: unknown[] = Array(12).fill(""); header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
  const row: unknown[] = Array(12).fill(""); row[0] = 1; row[1] = "Стол №999/99999"; row[11] = 0;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, row]), "Лист_1");
  await uploadMaterialSnapshot("metadata.xls", Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" })), userId, runtimePool);
  const asset: OneCFixedAsset = {
    externalId, code: "0001", inventoryNumber: null, barcode: null, name: "Скамья", category: null,
    location: null, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null,
    quantity: 1, residualCost: 100, acceptedAt: null, updatedAt: null,
  };
  const sourceSha256 = randomUUID().replaceAll("-", "").padEnd(64, "0");
  await new PostgresOneCFixedAssetRepository(runtimePool).saveBatch([asset], { sourceSha256, sourceFilename: "metadata.xml" });
  const batch = await runtimePool.query<{ id: string; version: number }>(`select id,version from "yu_inventory"."one_c_import_batches" where source_sha256=$1`, [sourceSha256]);
  const batchId = batch.rows[0]!.id;
  await new OneCReconciliationService(runtimePool).analyzeBatch(batchId, { version: batch.rows[0]!.version });
  const stored = await runtimePool.query<{ payload_hash: string }>(`select payload_hash from "yu_inventory"."one_c_fixed_asset_inbox" where external_id=$1`, [externalId]);
  return { userId, itemId, externalId, batchId, payloadHash: stored.rows[0]!.payload_hash };
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(config, { max: 1 });
  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally { await pool.end(); }
}
