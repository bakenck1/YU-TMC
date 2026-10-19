import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { PostgresOneCMaterialsRepository } from "@/lib/server/persistence/postgres/postgres-one-c-materials-repository";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";
import { InventoryAuditEnrichmentService } from "@/lib/server/inventory-audit-enrichment-service";
import { readMaterialRegistry, getMaterialRegistryPage } from "@/lib/server/one-c-material-registry";
import { exportInventorySourceAuditExcel } from "@/lib/server/excel/inventory-source-audit-excel";
import { Workbook } from "exceljs";

let config: DatabaseConfig, owner: Pool, pool: Pool;
const base: OneCMaterial = {
  externalId: null, code: "0000007692", name: "Принтер №1350/14444", inventoryNumber: "1350/14444",
  barcode: null, unit: "шт", quantity: "7", unitPrice: "9100", currency: "KZT",
  warehouseCode: null, warehouseExternalId: null, warehouseName: null,
  balanceSchemaVersion: 2, accountCode: "1317", responsibleCode: "001", responsibleName: "Иванов",
};

describe("live materials API replaces Excel as audit input", () => {
  beforeAll(async () => {
    config = readDatabaseConfig({ purpose: "migration", target: "test" });
    await reset();
    await migrateDatabase(config);
    owner = createPostgresPool(config, { max: 2 });
    pool = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "test" }), { max: 4 });
  });
  beforeEach(async () => {
    await owner.query('truncate "yu_inventory"."users", "yu_inventory"."one_c_import_batches", "yu_inventory"."one_c_fixed_asset_inbox", "yu_inventory"."one_c_material_import_batches", "yu_inventory"."one_c_material_inbox", "yu_inventory"."material_snapshots" cascade');
  });
  afterAll(async () => { await pool?.end(); await owner?.end(); await reset(); });

  it("creates dry-run without Excel and keeps all MOL balances, source fields and fingerprints", async () => {
    const fixture = await seed();
    await save([base, { ...base, responsibleCode: "002", quantity: "15" }, { ...base, responsibleCode: "003", quantity: "1" }]);
    const service = new OneCReconciliationService(pool);
    await service.analyzeBatch(fixture.batchId, { version: 1 });
    const audit = await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(audit.run.snapshot_id).toBeNull();
    expect(audit.run.material_source).toMatchObject({ kind: "materials_api", rowCount: 3, materialCount: 1 });
    expect(audit.run.inventory.stale).toBe(false);
    const found = audit.data.find(row => row.itemId === fixture.itemId)!;
    expect(found.source).toBe("excel"); // Backwards-compatible storage enum, not an Excel input.
    expect(found.excel).toHaveLength(3);
    expect(found.excel.map(row => row.endingBalance)).toEqual(["7", "15", "1"]);
    expect(found.excel[0]).toMatchObject({ sourceKind: "materials_api", accountCode: "1317", unitPrice: "9100", responsibleName: "Иванов" });
    const registry = await getMaterialRegistryPage({ page: 1, pageSize: 50, search: "0000007692" }, pool);
    expect(registry.total).toBe(3);
    expect(registry.data).toHaveLength(3);
    expect((await getMaterialRegistryPage({ page: 9, pageSize: 50 }, pool)).total).toBe(3);
    expect((await getMaterialRegistryPage({ page: 1, pageSize: 50, search: "%_' OR true--" }, pool)).total).toBe(0);
    const before = (await pool.query('select name,one_c_code,unit_price::text,quantity,version from "yu_inventory"."items" where id=$1', [fixture.itemId])).rows[0];
    expect(before).toMatchObject({ name: "Наше название", one_c_code: null, quantity: 1, version: 1 });
    const enrichment = new InventoryAuditEnrichmentService(pool);
    const plan = await enrichment.preview(fixture.batchId, fixture.actor);
    expect(plan.counts.ready).toBe(1);
    expect(plan.rows.find(row => row.itemId === fixture.itemId)?.nameSource).toBe("materials_api");
    const applied = await enrichment.apply(fixture.batchId, plan, fixture.actor);
    expect(applied.updated).toBe(1);
    const after = (await pool.query('select name,one_c_code,unit_price::text,quantity,version from "yu_inventory"."items" where id=$1', [fixture.itemId])).rows[0];
    expect(after).toMatchObject({ name: base.name, one_c_code: base.code, quantity: before.quantity, unit_price: before.unit_price, version: 2 });
    expect((await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 })).run.inventory.stale).toBe(true);
    const batch = await service.getBatch(fixture.batchId);
    await service.analyzeBatch(fixture.batchId, { version: Number(batch.version) });
    const repeated = await service.getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(repeated.run.inventory.stale).toBe(false);
    const sameCard = repeated.data.filter(row => row.itemId === fixture.itemId);
    expect(sameCard).toHaveLength(1);
    expect(sameCard[0].excel).toHaveLength(3);
    expect(sameCard[0].excel.every(row => row.matchedBy?.includes("code"))).toBe(true);
    expect((await enrichment.preview(fixture.batchId, fixture.actor)).counts).toMatchObject({ ready: 0, unchanged: 1 });
  });

  it.each(["name", "number", "barcode"] as const)("blocks enrichment when a nonmatching MOL balance contradicts the chosen material's %s", async field => {
    const f = await seed();
    const other = { ...base, responsibleCode: "002", inventoryNumber: "999/999", name: "Другая запись №999/999" };
    // Keep the second balance outside the identifier-matched subset even when
    // only its name is contradictory: its number claim is absent, not equal.
    if (field === "name") Object.assign(other, { inventoryNumber: null, name: "Противоречащее название" });
    if (field === "number") Object.assign(other, { name: "Принтер" });
    if (field === "barcode") Object.assign(other, { inventoryNumber: null, name: "Принтер", barcode: "999/999" });
    await save([base, other]);
    const service = new OneCReconciliationService(pool);
    await service.analyzeBatch(f.batchId, { version: 1 });
    const audit = await service.getInventoryAuditPage(f.batchId, { page: 1, pageSize: 50 });
    expect(audit.data.find(row => row.itemId === f.itemId)?.excel).toHaveLength(1);
    const enrichment = new InventoryAuditEnrichmentService(pool);
    const plan = await enrichment.preview(f.batchId, f.actor);
    expect(plan.rows.find(row => row.itemId === f.itemId)).toMatchObject({ eligible: false, reason: "source_ambiguous" });
    expect((await enrichment.apply(f.batchId, plan, f.actor)).updated).toBe(0);
    expect((await pool.query('select name,one_c_code,version from "yu_inventory"."items" where id=$1', [f.itemId])).rows[0])
      .toMatchObject({ name: "Наше название", one_c_code: null, version: 1 });
  });

  it("invalidates a reviewed proposal after a material API update without requiring an Excel upload", async () => {
    const f = await seed();
    await save([base]);
    const service = new OneCReconciliationService(pool);
    await service.analyzeBatch(f.batchId, { version: 1 });
    const enrichment = new InventoryAuditEnrichmentService(pool);
    const preview = await enrichment.preview(f.batchId, f.actor);
    await save([{ ...base, unitPrice: "9200" }], "2026-10-20T01:00:00Z");
    const audit = await service.getInventoryAuditPage(f.batchId, { page: 1, pageSize: 50 });
    expect(audit.run.inventory).toMatchObject({ materialSourceChanged: true, stale: true });
    expect(audit.data.find(row => row.itemId === f.itemId)?.excel[0].unitPrice).toBe("9100");
    await expect(enrichment.apply(f.batchId, preview, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    const batch = await service.getBatch(f.batchId);
    await service.analyzeBatch(f.batchId, { version: Number(batch.version) });
    const refreshed = await service.getInventoryAuditPage(f.batchId, { page: 1, pageSize: 50 });
    expect(refreshed.run.inventory.stale).toBe(false);
    expect(refreshed.data.find(row => row.itemId === f.itemId)?.excel[0].unitPrice).toBe("9200");
  });

  it("ignores archived Excel bytes, zero/negative balances and superseded aggregate rows", async () => {
    const f = await seed();
    // Legacy bytes remain stored but deliberately corrupt: live audit must never read them.
    await pool.query('insert into "yu_inventory"."material_snapshots"(id,filename,sha256,byte_size,source_file,accepted_count,skipped_count) values($1,$2,$3,4,$4,1,0)', [randomUUID(), "old.xls", "a".repeat(64), Buffer.from("fake")]);
    await save([{ ...base, balanceSchemaVersion: undefined, accountCode: undefined, responsibleCode: undefined }]);
    await new PostgresOneCMaterialsRepository(pool).saveSnapshot({ snapshotAt: "2026-10-20T01:00:00Z", replaceLegacyBalances: true,
      materials: [{ ...base, quantity: "0" }, { ...base, responsibleCode: "002", quantity: "-1" }] }, metadata());
    const source = await readMaterialRegistry(pool);
    expect(source.metadata).toMatchObject({ rowCount: 2, positiveRows: 0, nonPositiveRows: 2 });
    const service = new OneCReconciliationService(pool);
    await service.analyzeBatch(f.batchId, { version: 1 });
    const audit = await service.getInventoryAuditPage(f.batchId, { page: 1, pageSize: 50 });
    expect(audit.data.find(row => row.itemId === f.itemId)?.source).toBeNull();
    expect((await pool.query('select count(*)::int count from "yu_inventory"."material_snapshots"')).rows[0].count).toBe(1);
  });

  it("still runs fixed-asset audit before materials arrive, without requiring any Excel", async () => {
    const f = await seed();
    const service = new OneCReconciliationService(pool);
    await service.analyzeBatch(f.batchId, { version: 1 });
    const audit = await service.getInventoryAuditPage(f.batchId, { page: 1, pageSize: 50 });
    expect(audit.run.material_source).toMatchObject({ rowCount: 0, batchId: null });
    expect(audit.run.inventory.stale).toBe(false);
    expect(audit.data.find(row => row.itemId === f.itemId)?.result).toBe("missing");
  });

  it("exports API provenance, all balances, prices and MOL without relabelling historic XLS reports", async () => {
    const f = await seed();
    await save([base, { ...base, responsibleCode: "002", responsibleName: "Петров", quantity: "15" }]);
    const service = new OneCReconciliationService(pool);
    await service.analyzeBatch(f.batchId, { version: 1 });
    const exported = await service.exportInventoryAudit(f.batchId);
    const bytes = await exportInventorySourceAuditExcel(exported);
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    expect(workbook.getWorksheet("Только материалы")).toBeTruthy();
    const details = workbook.getWorksheet("Все совпадения материалов")!;
    expect(details.rowCount).toBe(3);
    expect(details.getRow(1).getCell(16).value).toBe("Учётная цена KZT");
    expect(details.getRow(3).getCell(14).value).toBe("002");
    expect(details.getRow(3).getCell(15).value).toBe("Петров");
    expect(details.getRow(3).getCell(16).value).toBe("9100");
  });
});

async function seed() {
  const userId = randomUUID(), roomId = randomUUID(), buildingId = randomUUID(), itemId = randomUUID();
  await pool.query('insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at) values($1,$2,$3,\'Admin\',\'admin\',now(),now())', [userId, `mat-${userId.slice(0, 8)}`, `${userId}@example.test`]);
  await pool.query('insert into "yu_inventory"."buildings"(id,name,name_key,address,address_key,created_by,updated_by) values($1,\'Building\',$2,\'Address\',$2,$3,$3)', [buildingId, buildingId, userId]);
  await pool.query('insert into "yu_inventory"."rooms"(id,building_id,designation,designation_key,floor_number,created_by,updated_by) values($1,$2,\'101\',$3,1,$4,$4)', [roomId, buildingId, roomId, userId]);
  await pool.query('insert into "yu_inventory"."items"(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by) values($1,\'Наше название\',1,100,$2,\'official\',$3::text,$3::text,$4,$4)', [itemId, roomId, "1350/14444", userId]);
  const asset: OneCFixedAsset = { externalId: randomUUID(), code: "OTHER", inventoryNumber: "999/999", barcode: null, name: "Другое ОС", category: null, location: null, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null, quantity: 1, residualCost: 100, acceptedAt: null, updatedAt: null };
  const source = metadata();
  await new PostgresOneCFixedAssetRepository(pool).saveBatch([asset], { sourceSha256: source.sourceSha256, sourceFilename: "audit.xml" });
  const batch = (await pool.query('select id from "yu_inventory"."one_c_import_batches" where source_sha256=$1', [source.sourceSha256])).rows[0];
  return { batchId: batch.id as string, itemId, actor: { userId, role: "admin" as const, sessionVersion: 1 } };
}
const metadata = () => ({ sourceSha256: createHash("sha256").update(randomUUID()).digest("hex"), requestId: randomUUID(), sourceFilename: "materials.xml" });
async function save(materials: OneCMaterial[], snapshotAt = "2026-10-19T01:00:00Z") {
  return new PostgresOneCMaterialsRepository(pool).saveSnapshot({ materials, snapshotAt }, metadata());
}
async function reset() {
  if (!config.databaseName.endsWith("_test")) throw new Error("Refusing to reset non-test database");
  const db = createPostgresPool(config, { max: 1 });
  try { await db.query('drop schema if exists "yu_migrations" cascade'); await db.query('drop schema if exists "yu_inventory" cascade'); }
  finally { await db.end(); }
}
