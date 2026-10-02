import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import * as XLSX from "xlsx";

import { OneCFixedAssetImportService } from "@/lib/application/services/one-c-fixed-asset-import-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { oneCFixedAssetPayload, parseOneCFixedAssets, type OneCFixedAsset } from "@/lib/server/integrations/one-c-fixed-assets";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import { createOneCFixedAssetsPostHandler } from "@/lib/server/http/one-c-fixed-assets-handler";
import { getSelectedMaterialSnapshot, uploadMaterialSnapshot } from "@/lib/server/material-snapshot-service";
import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";
import { InventoryItemService } from "@/lib/application/services/inventory-item-service";
import type { InventoryItemRepositories } from "@/lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { toInventoryItemView } from "@/lib/inventory-item-view";
import { filterInventoryItems } from "@/lib/inventory-list";

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
  beforeEach(async () => { await migrationPool.query('truncate table "yu_inventory"."inventory_source_audit_rows", "yu_inventory"."inventory_source_audit_runs", "yu_inventory"."one_c_publication_runs", "yu_inventory"."item_one_c_links", "yu_inventory"."one_c_import_batch_rows", "yu_inventory"."one_c_fixed_asset_inbox", "yu_inventory"."one_c_import_batches"'); });
  afterAll(async () => {
    await runtimePool?.end(); await migrationPool?.end(); await closeDatabase(); await resetSchemas(migrationConfig);
  });

  it("declares the migrated table contract and grants runtime write access", async () => {
    const columns = await migrationPool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'yu_inventory' and table_name = 'one_c_fixed_asset_inbox' order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(["external_id", "payload_hash", "payload", "received_at", "updated_at", "last_batch_id", "last_request_id", "last_seen_at"]);
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

  it("stores an uploaded XLS privately, selects it for dry-run, and reuses identical bytes", async () => {
    const userId = "e50d9aec-b46b-4e28-835b-119249259e76";
    await migrationPool.query(`insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at)
      values($1,'xls-admin','xls-admin@example.test','XLS admin','admin',now(),now())`, [userId]);
    const header: unknown[] = Array(12).fill("");
    header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
    const row: unknown[] = Array(12).fill("");
    row[0] = 1; row[1] = "холодильник №1350/16812 от 06.11.2025"; row[11] = 0;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, row]), "Лист_1");
    const bytes = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
    const first = await uploadMaterialSnapshot("материалы 2026.xls", bytes, userId, runtimePool);
    expect(first).toMatchObject({ filename: "материалы 2026.xls", acceptedCount: 1, skippedCount: 0, byteSize: bytes.length });
    expect(await getSelectedMaterialSnapshot(runtimePool)).toEqual(first);
    const second = await uploadMaterialSnapshot("материалы 2026.xls", bytes, userId, runtimePool);
    expect(second.id).toBe(first.id);
    const stored = await runtimePool.query<{ source_file: Buffer; count: number }>(`select s.source_file,count(r.*)::int count from "yu_inventory"."material_snapshots" s
      join "yu_inventory"."material_snapshot_rows" r on r.snapshot_id=s.id where s.id=$1 group by s.id`, [first.id]);
    expect(stored.rows[0]?.source_file.equals(bytes)).toBe(true);
    expect(stored.rows[0]?.count).toBe(1);
    const auditItemForeignKey = await migrationPool.query<{ count: number }>(`select count(*)::int count from pg_constraint
      where conname='inventory_source_audit_rows_item_id_items_id_fk'`);
    expect(auditItemForeignKey.rows[0]?.count).toBe(0);
    await expect(runtimePool.query(`update "yu_inventory"."material_snapshots" set filename='changed.xls' where id=$1`, [first.id])).rejects.toThrow(/immutable/);
    await expect(uploadMaterialSnapshot("bad.xls", Buffer.from("fake"), userId, runtimePool)).rejects.toThrow();
  });

  it("runs the real dry-run against PostgreSQL with an Excel number and an active site barcode", async () => {
    const userId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), itemId = randomUUID();
    const groupId = randomUUID(), externalId = randomUUID();
    await runtimePool.query(`insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at)
      values($1,$2,$3,'Audit admin','admin',now(),now())`, [userId, `audit-${userId.slice(0, 8)}`, `${userId}@example.test`]);
    await runtimePool.query(`insert into "yu_inventory"."buildings"(id,name,name_key,address,address_key,created_by,updated_by)
      values($1,'Audit building',$2,'Audit address',$2,$3,$3)`, [buildingId, `audit-${buildingId}`, userId]);
    await runtimePool.query(`insert into "yu_inventory"."rooms"(id,building_id,designation,designation_key,floor_number,created_by,updated_by)
      values($1,$2,'101',$3,1,$4,$4)`, [roomId, buildingId, `audit-${roomId}`, userId]);
    await runtimePool.query(`insert into "yu_inventory"."items"(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      values($1,'Ноутбук',1,100,$2,'official',$3,$4,$5,$5)`, [itemId, roomId, "1350-00065", "1350-00065", userId]);
    const sequence = await runtimePool.query<{ value: string }>(`select nextval('"yu_inventory"."local_barcode_sequence"')::text as value`);
    const localBarcode = `1350-00065-${sequence.rows[0]!.value.padStart(4, "0")}`;
    await runtimePool.query(`insert into "yu_inventory"."local_item_groups"
      (id,item_id,sequence_number,barcode_value,barcode_key,quantity,responsible_user_id,room_id,created_by)
      values($1,$2,$3,$4,$5,1,$6,$7,$6)`, [groupId, itemId, sequence.rows[0]!.value, localBarcode, localBarcode.toLowerCase(), userId, roomId]);

    const header: unknown[] = Array(12).fill(""); header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
    const row: unknown[] = Array(12).fill(""); row[0] = 1; row[1] = "ноутбук №1350-00065"; row[11] = 0;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, row]), "Лист_1");
    await uploadMaterialSnapshot("материалы 2026.xls", Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" })), userId, runtimePool);

    const oneCAsset: OneCFixedAsset = { ...asset, externalId, code: null, inventoryNumber: null, barcode: localBarcode, name: "Ноутбук" };
    await new PostgresOneCFixedAssetRepository(runtimePool).saveBatch([oneCAsset], { sourceSha256: randomUUID().replaceAll("-", "").padEnd(64, "0"), sourceFilename: "audit.xml" });
    await new PostgresOneCFixedAssetRepository(runtimePool).saveBatch([{ ...oneCAsset, barcode: "DIFFERENT", inventoryNumber: "OTHER-NUMBER" }], { sourceSha256: randomUUID().replaceAll("-", "").padEnd(64, "0"), sourceFilename: "newer.xml" });
    const batch = await runtimePool.query<{ id: string; version: number }>(`select id,version from "yu_inventory"."one_c_import_batches" where source_filename='audit.xml'`);
    const reconciliation = new OneCReconciliationService(runtimePool);
    await reconciliation.analyzeBatch(batch.rows[0]!.id, { version: batch.rows[0]!.version });
    const audit = await reconciliation.getInventoryAuditPage(batch.rows[0]!.id, { page: 1, pageSize: 50 });
    const found = audit.data.find((entry) => entry.itemId === itemId);
    expect(found?.source).toBe("1c+excel");
    expect(found?.oneC[0]?.matchedBy).toContain("barcode");
    expect(found?.oneC[0]?.matchedBarcodes).toContain(localBarcode);
    expect(found?.oneC[0]?.origins).toEqual(["selected_batch"]);
    expect(found?.excel[0]?.inventoryNumber).toBe("1350-00065");
    expect(audit.run.counts.total).toBe(audit.data.length);
    const searched = await reconciliation.getInventoryAuditPage(batch.rows[0]!.id, { page: 1, pageSize: 50, search: localBarcode });
    expect(searched.data.map((entry) => entry.itemId)).toContain(itemId);
    const planRow = await runtimePool.query<{ proposed_action: string; matched_item_id: string | null }>(
      `select proposed_action,matched_item_id from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and external_id=$2`,
      [batch.rows[0]!.id, externalId],
    );
    expect(planRow.rows[0]?.proposed_action).not.toBe("link");
    expect(planRow.rows[0]?.matched_item_id).toBeNull();
    const links = await runtimePool.query<{ count: number }>(`select count(*)::int as count from "yu_inventory"."item_one_c_links" where item_id=$1`, [itemId]);
    expect(links.rows[0]?.count).toBe(0);
  });

  it("reports a slashless 1C number as a possible match while keeping publication blocked", async () => {
    const userId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), itemId = randomUUID(), externalId = randomUUID();
    await runtimePool.query(`insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at)
      values($1,$2,$3,'Slash audit admin','admin',now(),now())`, [userId, `slash-${userId.slice(0, 8)}`, `${userId}@example.test`]);
    await runtimePool.query(`insert into "yu_inventory"."buildings"(id,name,name_key,address,address_key,created_by,updated_by)
      values($1,'Slash audit building',$2,'Slash audit address',$2,$3,$3)`, [buildingId, `slash-${buildingId}`, userId]);
    await runtimePool.query(`insert into "yu_inventory"."rooms"(id,building_id,designation,designation_key,floor_number,created_by,updated_by)
      values($1,$2,'101',$3,1,$4,$4)`, [roomId, buildingId, `slash-${roomId}`, userId]);
    await runtimePool.query(`insert into "yu_inventory"."items"(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      values($1,'Лабораторный стенд',1,100,$2,'official','123/759','123/759',$3,$3)`, [itemId, roomId, userId]);

    const header: unknown[] = Array(12).fill(""); header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
    const row: unknown[] = Array(12).fill(""); row[0] = 1; row[1] = "другой предмет №999/888"; row[11] = 0;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, row]), "Лист_1");
    await uploadMaterialSnapshot("slash-audit.xls", Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" })), userId, runtimePool);

    await new PostgresOneCFixedAssetRepository(runtimePool).saveBatch([{ ...asset, externalId, code: null, inventoryNumber: "123759", barcode: null, name: "Лабораторный стенд" }], { sourceSha256: randomUUID().replaceAll("-", "").padEnd(64, "0"), sourceFilename: "slash-audit.xml" });
    const batch = await runtimePool.query<{ id: string; version: number }>(`select id,version from "yu_inventory"."one_c_import_batches" where source_filename='slash-audit.xml'`);
    const reconciliation = new OneCReconciliationService(runtimePool);
    const plan = await reconciliation.analyzeBatch(batch.rows[0]!.id, { version: batch.rows[0]!.version });
    const audit = await reconciliation.getInventoryAuditPage(batch.rows[0]!.id, { page: 1, pageSize: 50, search: "123/759" });
    const found = audit.data.find((entry) => entry.itemId === itemId);
    expect(found?.source).toBe("1c");
    expect(found?.oneC[0]?.inventoryNumber).toBe("123759");
    expect(found?.oneC[0]?.matchedBy).toContain("number_without_slash");
    expect(audit.run.counts.possible).toBeGreaterThanOrEqual(1);
    expect(plan.create).toBe(0);
    const batchRow = await runtimePool.query<{ review_state: string }>(`select review_state from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and external_id=$2`, [batch.rows[0]!.id, externalId]);
    expect(batchRow.rows[0]?.review_state).toBe("blocked");
  });

  it("reparses an immutable old XLS snapshot, recovers description numbers and preserves saved evidence", async () => {
    const userId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), snapshotId = randomUUID();
    await runtimePool.query(`insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at)
      values($1,$2,$3,'Description audit admin','admin',now(),now())`, [userId, `description-${userId.slice(0, 8)}`, `${userId}@example.test`]);
    await runtimePool.query(`insert into "yu_inventory"."buildings"(id,name,name_key,address,address_key,created_by,updated_by)
      values($1,'Description building',$2,'Description address',$2,$3,$3)`, [buildingId, `description-${buildingId}`, userId]);
    await runtimePool.query(`insert into "yu_inventory"."rooms"(id,building_id,designation,designation_key,floor_number,created_by,updated_by)
      values($1,$2,'101',$3,1,$4,$4)`, [roomId, buildingId, `description-${roomId}`, userId]);
    const itemIds = new Map<string, string>();
    for (const [number, name] of [["1350/14464", "Планшет"], ["206/486-487", "Плита Gefest"], ["206/486", "Плита"], ["206/487", "Другая плита"], ["050-0002223", "Принтер"]]) {
      const itemId = randomUUID();
      itemIds.set(number, itemId);
      await runtimePool.query(`insert into "yu_inventory"."items"(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
        values($1,$2,1,100,$3,'official',$4::text,$4::text,$5,$5)`, [itemId, name, roomId, number, userId]);
    }
    const header: unknown[] = Array(12).fill(""); header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
    const descriptions = ["Планшет Samsung Galaxy Tab 1350/14464 от 26.03.20", "Плита Gefest 1140 ком. инв.№206/486-487 15 этаж", "Принтер М1132MFP от 15.02.13 №050-0002223", "скотч 48/300 от 03.12.2024"];
    const lines = descriptions.map((description, index) => {
      const row: unknown[] = Array(12).fill(""); row[0] = index + 1; row[1] = description; row[11] = 0;
      return row;
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...lines]), "Лист_1");
    const bytes = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // This is the exact import shape from the old parser: the tablet was omitted,
    // and the floor number was accidentally included in the plate's number.
    await runtimePool.query(`insert into "yu_inventory"."material_snapshots"(id,filename,sha256,byte_size,source_file,accepted_count,skipped_count)
      values($1,'old-description.xls',$2,$3,$4,2,2)`, [snapshotId, sha256, bytes.length, bytes]);
    await runtimePool.query(`insert into "yu_inventory"."material_snapshot_rows"(snapshot_id,row_number,nomenclature,inventory_number,number_key,ending_balance)
      values($1,3,$2,'206/486-487 15','206/486-487 15','0'),($1,4,$3,'050-0002223','050-0002223','0')`, [snapshotId, descriptions[1], descriptions[2]]);
    await runtimePool.query(`insert into "yu_inventory"."material_snapshot_selection"(id,snapshot_id,selected_by) values(1,$1,$2)
      on conflict(id) do update set snapshot_id=excluded.snapshot_id,selected_by=excluded.selected_by,selected_at=now()`, [snapshotId, userId]);
    const beforeItems = await runtimePool.query(`select id,inventory_number,version from "yu_inventory"."items" where id=any($1::uuid[]) order by id`, [[...itemIds.values()]]);
    const importer = new PostgresOneCFixedAssetRepository(runtimePool);
    const sourceSha256 = randomUUID().replaceAll("-", "").padEnd(64, "0");
    await importer.saveBatch([{ ...asset, externalId: randomUUID(), code: null, inventoryNumber: "UNRELATED-DESCRIPTION", barcode: null, name: "Другой предмет" }], { sourceSha256, sourceFilename: "description.xml" });
    const batch = (await runtimePool.query<{ id: string; version: number }>(`select id,version from "yu_inventory"."one_c_import_batches" where source_sha256=$1`, [sourceSha256])).rows[0]!;
    const oldRunId = randomUUID();
    const oldPlateEvidence = [{ rowNumber: 3, nomenclature: descriptions[1], inventoryNumber: "206/486-487 15", endingBalance: "0", matchedBy: ["site_number"], matchedBarcodes: [] }];
    await runtimePool.query(`insert into "yu_inventory"."inventory_source_audit_runs"(id,batch_id,batch_version,snapshot_id,one_c_registry_sha256,run_at,counts)
      values($1,$2,$3,$4,$5,now()-interval '1 minute',$6::jsonb)`, [oldRunId, batch.id, batch.version, snapshotId, sourceSha256, JSON.stringify({ total: 1, oneCOnly: 0, excelOnly: 1, both: 0, missing: 0, temporary: 0 })]);
    await runtimePool.query(`insert into "yu_inventory"."inventory_source_audit_rows"(run_id,item_id,item_name,site_number,site_barcodes,number_kind,item_version,result,source,one_c_matches,excel_matches)
      values($1,$2,'Плита Gefest','206/486-487','[]'::jsonb,'official',1,'matched','excel','[]'::jsonb,$3::jsonb)`, [oldRunId, itemIds.get("206/486-487"), JSON.stringify(oldPlateEvidence)]);
    const reconciliation = new OneCReconciliationService(runtimePool);
    expect(await reconciliation.getInventoryAuditExcelRow(batch.id, 3)).toMatchObject({ inventory_number: "206/486-487 15", nomenclature: descriptions[1] });

    const selected = await getSelectedMaterialSnapshot(runtimePool);
    expect(selected).toMatchObject({ id: snapshotId, acceptedCount: 3, skippedCount: 1, importedAcceptedCount: 2, importedSkippedCount: 2 });
    await reconciliation.analyzeBatch(batch.id, { version: batch.version });
    const audit = await reconciliation.getInventoryAuditPage(batch.id, { page: 1, pageSize: 50 });
    const byId = new Map(audit.data.map((row) => [row.itemId, row]));
    const tablet = byId.get(itemIds.get("1350/14464")!)!;
    expect(tablet.source).toBe("excel");
    expect(tablet.excel[0]).toMatchObject({ rowNumber: 2, inventoryNumber: "1350/14464", numberIsUnmarked: true });
    expect(tablet.excel[0].matchedBy).toContain("number_in_description");
    expect(byId.get(itemIds.get("206/486-487")!)?.source).toBe("excel");
    expect(byId.get(itemIds.get("206/486-487")!)?.excel[0]).toMatchObject({ inventoryNumber: "206/486", sourceInventoryNumber: "206/486-487" });
    expect(byId.get(itemIds.get("206/486")!)?.source).toBe("excel");
    expect(byId.get(itemIds.get("206/487")!)?.result).toBe("missing");
    expect(byId.get(itemIds.get("050-0002223")!)?.source).toBe("excel");
    expect(await reconciliation.getInventoryAuditExcelRow(batch.id, 2)).toMatchObject({ row_number: 2, inventory_number: "1350/14464", nomenclature: descriptions[0] });
    expect(await reconciliation.getInventoryAuditExcelRow(batch.id, 3)).toMatchObject({ inventory_number: "206/486", nomenclature: descriptions[1] });
    const oldSaved = await runtimePool.query<{ excel_matches: unknown }>(`select excel_matches from "yu_inventory"."inventory_source_audit_rows" where run_id=$1`, [oldRunId]);
    expect(oldSaved.rows[0]?.excel_matches).toEqual(oldPlateEvidence);
    const reuploaded = await uploadMaterialSnapshot("same-description.xls", bytes, userId, runtimePool);
    expect(reuploaded).toMatchObject({ id: snapshotId, filename: "old-description.xls", acceptedCount: 3, skippedCount: 1, importedAcceptedCount: 2, importedSkippedCount: 2 });
    const stored = await runtimePool.query<{ source_file: Buffer; accepted_count: number; skipped_count: number; row_count: number }>(`select s.source_file,s.accepted_count,s.skipped_count,count(r.*)::int row_count from "yu_inventory"."material_snapshots" s
      join "yu_inventory"."material_snapshot_rows" r on r.snapshot_id=s.id where s.id=$1 group by s.id`, [snapshotId]);
    expect(stored.rows[0]?.source_file.equals(bytes)).toBe(true);
    expect(stored.rows[0]).toMatchObject({ accepted_count: 2, skipped_count: 2, row_count: 2 });
    const afterItems = await runtimePool.query(`select id,inventory_number,version from "yu_inventory"."items" where id=any($1::uuid[]) order by id`, [[...itemIds.values()]]);
    expect(afterItems.rows).toEqual(beforeItems.rows);
    expect((await runtimePool.query<{ count: number }>(`select count(*)::int count from "yu_inventory"."item_one_c_links" where item_id=any($1::uuid[])`, [[...itemIds.values()]])).rows[0]?.count).toBe(0);
  });

  it("searches published 1C identifiers for created and linked items while ignoring later unpublished imports", async () => {
    const userId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID();
    await runtimePool.query(`insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at)
      values($1,$2,$3,'Search admin','admin',now(),now())`, [userId, `search-${userId.slice(0, 8)}`, `${userId}@example.test`]);
    await runtimePool.query(`insert into "yu_inventory"."buildings"(id,name,name_key,address,address_key,created_by,updated_by)
      values($1,'Search building',$2,'Search address',$2,$3,$3)`, [buildingId, `search-${buildingId}`, userId]);
    await runtimePool.query(`insert into "yu_inventory"."rooms"(id,building_id,designation,designation_key,floor_number,created_by,updated_by)
      values($1,$2,'101',$3,1,$4,$4)`, [roomId, buildingId, `search-${roomId}`, userId]);
    const importer = new PostgresOneCFixedAssetRepository(runtimePool);
    const reconciliation = new OneCReconciliationService(runtimePool);
    async function upload(value: OneCFixedAsset) {
      const sourceSha256 = randomUUID().replaceAll("-", "").padEnd(64, "0");
      await importer.saveBatch([value], { sourceSha256, sourceFilename: "search.xml", requestId: randomUUID() });
      const batch = await runtimePool.query<{ id: string }>(`select id from "yu_inventory"."one_c_import_batches" where source_sha256=$1`, [sourceSha256]);
      return batch.rows[0]!.id;
    }
    for (const action of ["create", "link"] as const) {
      const externalId = randomUUID();
      const inventoryNumber = `SEARCH-${action}-${externalId.slice(0, 8)}`;
      const importedAsset: OneCFixedAsset = {
        ...asset, externalId, inventoryNumber, name: `Accounting monoblock ${action}`,
        code: `SOURCE-${action}-000001`, barcode: `BARCODE-${action}-000002`, quantity: 1,
      };
      let expectedItemId: string | undefined;
      if (action === "link") {
        expectedItemId = randomUUID();
        await runtimePool.query(`insert into "yu_inventory"."items"(id,name,item_type,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
          values($1,'Existing monoblock','electronics',1,0,$2,'official',$3,$4,$5,$5)`,
        [expectedItemId, roomId, inventoryNumber, inventoryNumber.toLowerCase(), userId]);
      }
      const batchId = await upload(importedAsset);
      const decision = action === "create"
        ? { roomId, itemType: "electronics", confirmCreate: true, confirmConditionDefault: true }
        : { itemId: expectedItemId, confirmLink: true };
      await runtimePool.query(`update "yu_inventory"."one_c_import_batch_rows" set review_state='approved',proposed_action=$3,matched_item_id=$4,decision=$5::jsonb,decided_by=$6,decided_at=now() where batch_id=$1 and external_id=$2`,
        [batchId, externalId, action, expectedItemId ?? null, JSON.stringify(decision), userId]);
      await runtimePool.query(`insert into "yu_inventory"."one_c_publication_runs"(id,batch_id,idempotency_key,state,requested_by)
        values($1,$2,$3,'pending',$4)`, [randomUUID(), batchId, randomUUID(), userId]);
      expect(await reconciliation.processNextPublication()).toBe(true);
      const published = await runtimePool.query<{ review_state: string; published_item_id: string }>(
        `select review_state,published_item_id from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and external_id=$2`, [batchId, externalId]);
      expect(published.rows[0]?.review_state).toBe("published");
      const itemId = published.rows[0]!.published_item_id;
      if (expectedItemId) expect(itemId).toBe(expectedItemId);
      // A fresh XML upload updates the inbox, but remains outside the published catalogue.
      await upload({ ...importedAsset, barcode: `UNPUBLISHED-${action}`, code: `UNPUBLISHED-CODE-${action}`, name: `Unpublished accounting name ${action}` });
      const repositories = createPostgresInventoryItemRepositories(runtimePool);
      const unitOfWork = {
        transaction: async (work: (repos: InventoryItemRepositories) => unknown) => work(repositories),
      } as UnitOfWork<InventoryItemRepositories>;
      const service = new InventoryItemService(unitOfWork, { now: () => new Date() },
        { create: () => "unused" }, { create: () => new Uint8Array(16) }, { next: () => "unused" });
      const dto = (await service.listItems({ userId, role: "admin" })).find((item) => item.id === itemId)!;
      const view = toInventoryItemView(dto);
      expect(view.inventoryNumber).toBe(inventoryNumber);
      expect(view.oneCCode).toBeUndefined();
      expect(view.searchIdentifiers).toEqual(expect.arrayContaining([importedAsset.code, importedAsset.barcode, inventoryNumber]));
      expect(view.name).toBe(action === "link" ? "Existing monoblock" : importedAsset.name);
      expect(view.searchNames).toEqual([importedAsset.name]);
      const filters = { category: "all", location: "all", statusKey: "all" };
      for (const query of [importedAsset.code!, importedAsset.barcode!, importedAsset.name]) {
        expect(filterInventoryItems([view], { ...filters, query }).map((item) => item.id)).toEqual([itemId]);
      }
      expect(filterInventoryItems([view], { ...filters, query: `UNPUBLISHED-${action}` })).toEqual([]);
      expect(filterInventoryItems([view], { ...filters, query: `UNPUBLISHED-CODE-${action}` })).toEqual([]);
      expect(filterInventoryItems([view], { ...filters, query: `Unpublished accounting name ${action}` })).toEqual([]);
    }
  });

  it("creates an immutable, idempotent import snapshot alongside the inbox projection", async () => {
    const handler = createOneCFixedAssetsPostHandler({
      service: new OneCFixedAssetImportService(new PostgresOneCFixedAssetRepository(runtimePool)),
      apiKey: () => "database-test-key",
    });
    const makeRequest = () => new Request("https://inventory.example/api/integrations/1c/fixed-assets", {
      method: "POST", headers: { authorization: "Bearer database-test-key", "content-type": "application/xml", "x-source-filename": "snapshot.xml" },
      body: `<FixedAssets><FixedAsset><GUID>${asset.externalId}</GUID><Name>${asset.name}</Name><ResidualCost>-1</ResidualCost></FixedAsset></FixedAssets>`,
    });
    expect((await handler(makeRequest())).status).toBe(200);
    expect((await handler(makeRequest())).status).toBe(200);
    const batches = await runtimePool.query<{ count: number }>('select count(*)::int count from "yu_inventory"."one_c_import_batches"');
    const rows = await runtimePool.query<{ count: number }>('select count(*)::int count from "yu_inventory"."one_c_import_batch_rows"');
    expect(batches.rows[0]?.count).toBe(1);
    expect(rows.rows[0]?.count).toBe(1);
    await expect(runtimePool.query(`update "yu_inventory"."one_c_import_batch_rows" set payload='{}'::jsonb`)).rejects.toThrow(/immutable 1C batch source fields/);
    const projection = await runtimePool.query<{ linked: boolean }>('select last_batch_id is not null as linked from "yu_inventory"."one_c_fixed_asset_inbox"');
    expect(projection.rows[0]?.linked).toBe(true);
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

  it("replays differently-cased UUIDs into one canonical inbox row", async () => {
    const repository = new PostgresOneCFixedAssetRepository(runtimePool);
    const upper = asset.externalId.toUpperCase();
    const first = parseAssetXml(upper);
    const replay = parseAssetXml(asset.externalId);

    await expect(repository.saveBatch(first)).resolves.toEqual({ created: 1, updated: 0, unchanged: 0 });
    await expect(repository.saveBatch(replay)).resolves.toEqual({ created: 0, updated: 0, unchanged: 1 });
    await expect(runtimePool.query<{ external_id: string }>(
      'select external_id from "yu_inventory"."one_c_fixed_asset_inbox"',
    )).resolves.toMatchObject({ rows: [{ external_id: asset.externalId }] });
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

function parseAssetXml(externalId: string) {
  return parseOneCFixedAssets(`<FixedAssets><FixedAsset><GUID>${externalId}</GUID><Name>${asset.name}</Name><Status>${asset.status}</Status><ResidualCost>${asset.residualCost}</ResidualCost></FixedAsset></FixedAssets>`);
}
