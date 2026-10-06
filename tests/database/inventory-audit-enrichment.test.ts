import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import * as XLSX from "xlsx";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { uploadMaterialSnapshot } from "@/lib/server/material-snapshot-service";
import { InventoryAuditEnrichmentService } from "@/lib/server/inventory-audit-enrichment-service";
import { OneCReconciliationService } from "@/lib/server/one-c-reconciliation-service";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import { InventoryItemService } from "@/lib/application/services/inventory-item-service";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

let migrationConfig: DatabaseConfig;
let migrationPool: Pool;
let runtimePool: Pool;

const ORIGINAL_NAME = "Ноутбук";
const SOURCE_NAME = "Ноутбук Lenovo IdeaPad №2411/00388";

describe("confirmed inventory audit enrichment against PostgreSQL", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    migrationPool = createPostgresPool(migrationConfig, { max: 2 });
    runtimePool = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "test" }), { max: 4 });
  });
  beforeEach(async () => {
    if (!migrationConfig.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to clear a database without the _test suffix.");
    await migrationPool.query(`truncate table
      "yu_inventory"."users", "yu_inventory"."buildings", "yu_inventory"."items",
      "yu_inventory"."barcode_registry", "yu_inventory"."audit_records",
      "yu_inventory"."material_snapshot_selection", "yu_inventory"."material_snapshot_rows", "yu_inventory"."material_snapshots",
      "yu_inventory"."inventory_source_audit_rows", "yu_inventory"."inventory_source_audit_runs",
      "yu_inventory"."item_one_c_links", "yu_inventory"."one_c_import_batch_rows",
      "yu_inventory"."one_c_fixed_asset_inbox", "yu_inventory"."one_c_import_batches" cascade`);
  });
  afterAll(async () => {
    await runtimePool?.end();
    await migrationPool?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("uses the real saved XLS and 1C evidence, previews without edits, and persists the agreed code and source name atomically", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts.ready).toBe(1);
    expect(plan.rows.find((row) => row.itemId === fixture.itemId)).toMatchObject({
      eligible: true, changed: true, nextCode: "00003254", nextName: SOURCE_NAME,
    });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });

    const result = await service.apply(fixture.batchId, plan, fixture.actor);
    expect(result).toMatchObject({ updated: 1, unchanged: 0, skipped: 0, planHash: plan.planHash });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2, updated_by: fixture.userId });
    const records = await runtimePool.query(`select actor_id,actor_role_snapshot,before_values,after_values,metadata
      from "yu_inventory"."audit_records" where subject_id=$1 and action='item.audit_enrichment'`, [fixture.itemId]);
    expect(records.rows).toHaveLength(1);
    expect(records.rows[0]).toMatchObject({
      actor_id: fixture.userId, actor_role_snapshot: "admin",
      before_values: { name: ORIGINAL_NAME, oneCCode: null, version: 1 },
      after_values: { name: SOURCE_NAME, oneCCode: "00003254", version: 2 },
      metadata: { batchId: fixture.batchId, runId: plan.runId, planHash: plan.planHash, externalId: fixture.externalId, nameSource: "1c", codeStatus: "confirmed" },
    });
  });

  it("skips a rename that breaks a shared monitor/system-unit number, including an archived peer, without blocking other cards", async () => {
    const paired = await createFixture({ sharedNumberPeer: true });
    const independent = await createFixture({ inventoryNumber: "2411/00389" });
    await expect(runtimePool.query(`update "yu_inventory"."items" set name=$2 where id=$1`, [paired.itemId, SOURCE_NAME]))
      .rejects.toMatchObject({ code: "23505", message: "inventory number duplicate is allowed only for one monitor and one system unit" });
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(independent.batchId, independent.actor);
    expect(plan.rows.find((row) => row.itemId === paired.itemId)).toMatchObject({
      eligible: false, changed: false, reason: "shared_number_conflict", nextName: "Монитор",
    });
    expect(plan.counts).toEqual({ ready: 1, unchanged: 0, skipped: 1 });
    const result = await service.apply(independent.batchId, plan, independent.actor);
    expect(result).toMatchObject({ updated: 1, skipped: 1 });
    expect(await itemState(paired.itemId)).toMatchObject({ name: "Монитор", one_c_code: null, version: 1 });
    expect(await itemState(independent.itemId)).toMatchObject({ one_c_code: "00003254", version: 2 });
    expect(await service.apply(independent.batchId, plan, independent.actor)).toEqual(result);
  });

  it.each([
    { sourceName: "Монитор Dell №2411/00388", expectedName: "Монитор Dell №2411/00388", oneCOnly: false },
    { sourceName: "Монитор", expectedName: "Монитор", oneCOnly: true },
  ])("allows a compatible shared-number rename or code-only update: $sourceName", async ({ sourceName, expectedName, oneCOnly }) => {
    const fixture = await createFixture({ sharedNumberPeer: true, sourceName, oneCOnly });
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts).toEqual({ ready: 1, unchanged: 0, skipped: 0 });
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: expectedName, one_c_code: "00003254", version: 2 });
  });

  it("persists both preferred 1C values even when Excel supplies a different code", async () => {
    const fixture = await createFixture({ excelCode: "00003255" });
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts.ready).toBe(1);
    expect(plan.rows[0]).toMatchObject({ nameSource: "1c", codeStatus: "confirmed", nextCode: "00003254" });
    const result = await service.apply(fixture.batchId, plan, fixture.actor);
    expect(result.updated).toBe(1);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2 });
  });

  it("applies an Excel-only name and code, audits its source, and replays once", async () => {
    const fixture = await createFixture({ excelOnly: true });
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.rows[0]).toMatchObject({ nameSource: "excel", codeStatus: "confirmed", nextName: SOURCE_NAME, nextCode: "00003254" });
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2 });
    const audit = await runtimePool.query(`select metadata from "yu_inventory"."audit_records" where action='item.audit_enrichment'`);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({ nameSource: "excel", codeStatus: "confirmed", excelRowNumber: 2 });
  });

  it("applies a 1C-only name and code without depending on Excel confirmation", async () => {
    const fixture = await createFixture({ oneCOnly: true });
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.rows[0]).toMatchObject({ nameSource: "1c", codeStatus: "confirmed", nextName: SOURCE_NAME, nextCode: "00003254" });
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2 });
  });

  it("reviews and audits replacement of an existing code with the preferred source code", async () => {
    const fixture = await createFixture();
    await runtimePool.query(`update "yu_inventory"."items" set one_c_code='00009999' where id=$1`, [fixture.itemId]);
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.rows[0]).toMatchObject({ currentCode: "00009999", nextCode: "00003254", nameSource: "1c" });
    expect(await itemState(fixture.itemId)).toMatchObject({ one_c_code: "00009999", version: 1 });
    await service.apply(fixture.batchId, plan, fixture.actor);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2 });
    const audit = await runtimePool.query(`select before_values,after_values from "yu_inventory"."audit_records" where action='item.audit_enrichment'`);
    expect(audit.rows[0]).toMatchObject({ before_values: { oneCCode: "00009999" }, after_values: { oneCCode: "00003254" } });
  });

  it("persists the agreed name and code from the selected 1C batch and Excel when there is no current-registry copy", async () => {
    const fixture = await createFixture({ selectedBatchOnly: true });
    const audit = await new OneCReconciliationService(runtimePool).getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(audit.data.find((row) => row.itemId === fixture.itemId)?.oneC[0]?.origins).toEqual(["selected_batch"]);
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts).toEqual({ ready: 1, unchanged: 0, skipped: 0 });
    expect(plan.rows[0]).toMatchObject({ eligible: true, nextName: SOURCE_NAME, nextCode: "00003254" });
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2 });
    const batchRows = await runtimePool.query(`select review_state,published_item_id from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1`, [fixture.batchId]);
    expect(batchRows.rows.every((row) => row.review_state !== "published" && row.published_item_id == null)).toBe(true);
    const links = await runtimePool.query(`select item_id from "yu_inventory"."item_one_c_links" where item_id=$1`, [fixture.itemId]);
    expect(links.rows).toHaveLength(0);
  });

  it("does not choose between conflicting selected and current names even when the codes and numbers agree", async () => {
    const fixture = await createFixture({ divergentCurrentName: true });
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts).toEqual({ ready: 0, unchanged: 0, skipped: 1 });
    expect(plan.rows[0].reason).toBe("source_ambiguous");
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(0);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
    await expectNoEnrichmentAudit();
  });

  it("checks a contradictory current 1C copy even when its changed identifier no longer matches any card", async () => {
    const fixture = await createFixture({ divergentCurrentIdentity: true });
    const audit = await new OneCReconciliationService(runtimePool).getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(audit.data.find((row) => row.itemId === fixture.itemId)?.oneC.map((source) => source.origins)).toEqual([["selected_batch"]]);
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts).toEqual({ ready: 0, unchanged: 0, skipped: 1 });
    expect(plan.rows[0].reason).toBe("source_ambiguous");
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(0);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
    await expectNoEnrichmentAudit();
  });

  it("checks a contradictory selected 1C copy even when only the current registry matches the card", async () => {
    const fixture = await createFixture({ divergentSelectedIdentity: true });
    const audit = await new OneCReconciliationService(runtimePool).getInventoryAuditPage(fixture.batchId, { page: 1, pageSize: 50 });
    expect(audit.data.find((row) => row.itemId === fixture.itemId)?.oneC.map((source) => source.origins)).toEqual([["current_registry"]]);
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts).toEqual({ ready: 0, unchanged: 0, skipped: 1 });
    expect(plan.rows[0].reason).toBe("source_ambiguous");
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(0);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
    await expectNoEnrichmentAudit();
  });

  it("only the administrator receives the saved code while warehouse searches keep published numbers and barcodes", async () => {
    const fixture = await createFixture();
    const enrichment = new InventoryAuditEnrichmentService(runtimePool);
    await enrichment.apply(fixture.batchId, await enrichment.preview(fixture.batchId, fixture.actor), fixture.actor);
    const publishedBatchId = await saveAssets([{ ...fixture.asset, barcode: "PUBLISHED-BARCODE" }]);
    await runtimePool.query(`update "yu_inventory"."one_c_import_batch_rows"
      set review_state='published',published_item_id=$2,published_at=now()
      where batch_id=$1 and external_id=$3`, [publishedBatchId, fixture.itemId, fixture.externalId]);
    await runtimePool.query(`insert into "yu_inventory"."item_one_c_links"
      (external_id,item_id,source_code,source_inventory_number,linked_by,link_method,last_batch_id,last_payload_hash)
      select external_id,$2,'00003254','SOURCE-INVENTORY',$3,'manual',batch_id,payload_hash
      from "yu_inventory"."one_c_import_batch_rows" where batch_id=$1 and external_id=$4`,
    [publishedBatchId, fixture.itemId, fixture.userId, fixture.externalId]);
    const items = new InventoryItemService(new PostgresUnitOfWork(() => runtimePool, createPostgresInventoryItemRepositories),
      { now: () => new Date() }, { create: randomUUID }, { create: () => new Uint8Array(16) }, { next: () => "unused" });
    const admin = await items.findItem(fixture.itemId, fixture.actor);
    expect(admin.oneCCode).toBe("00003254");
    expect(admin.searchIdentifiers).toContain("00003254");
    const warehouseActor = { userId: fixture.userId, role: "warehouse" as const };
    const warehouse = await items.findItem(fixture.itemId, warehouseActor);
    expect(warehouse).not.toHaveProperty("oneCCode");
    expect(warehouse.searchIdentifiers).toEqual(["PUBLISHED-BARCODE", "SOURCE-INVENTORY"]);
    const [listed] = await items.listItems(warehouseActor);
    expect(listed).not.toHaveProperty("oneCCode");
    expect(listed?.searchIdentifiers).toEqual(["PUBLISHED-BARCODE", "SOURCE-INVENTORY"]);
  });

  it("skips duplicate 1C identifiers rather than selecting the first source", async () => {
    const fixture = await createFixture({ duplicateOneC: true });
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    expect(plan.counts.ready).toBe(0);
    expect(plan.counts.skipped).toBe(1);
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(0);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
  });

  it("rejects a stale item after preview and never overwrites a newer administrator edit", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    await runtimePool.query(`update "yu_inventory"."items" set name='Ручное изменение',version=version+1 where id=$1`, [fixture.itemId]);
    await expect(service.apply(fixture.batchId, plan, fixture.actor)).rejects.toMatchObject({ kind: "conflict", publicCode: "inventory_audit_enrichment_stale" });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: "Ручное изменение", one_c_code: null, version: 2 });
    await expectNoEnrichmentAudit();
  });

  it("rejects a changed selected Excel source even when its identifiers still agree", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    await uploadMaterialSnapshot("материалы 2026.xls", materialFile("00003254", SOURCE_NAME, 2), fixture.userId, runtimePool);
    await expect(service.apply(fixture.batchId, plan, fixture.actor)).rejects.toMatchObject({ kind: "conflict", publicCode: "inventory_audit_enrichment_stale" });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
    await expectNoEnrichmentAudit();
  });

  it("rejects a changed current 1C registry while keeping the reviewed batch immutable", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    await saveAssets([{ ...fixture.asset, name: "Новый вариант из 1С" }]);
    await expect(service.apply(fixture.batchId, plan, fixture.actor)).rejects.toMatchObject({ kind: "conflict", publicCode: "inventory_audit_enrichment_stale" });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
    await expectNoEnrichmentAudit();
  });

  it("rejects an employee actor for both preview and apply", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    const actor = { ...fixture.actor, role: "employee" as const };
    await expect(service.preview(fixture.batchId, actor)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(service.apply(fixture.batchId, plan, actor)).rejects.toMatchObject({ kind: "forbidden" });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
  });

  it("rechecks a revoked administrator's persisted role inside the mutation", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    await runtimePool.query(`update "yu_inventory"."users" set role='employee',version=version+1 where id=$1`, [fixture.userId]);
    await expect(service.apply(fixture.batchId, plan, fixture.actor)).rejects.toMatchObject({ kind: "forbidden" });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
    await expectNoEnrichmentAudit();
  });

  it("rejects an outdated session even while the persisted user remains an administrator", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    await runtimePool.query(`update "yu_inventory"."users" set version=version+1 where id=$1`, [fixture.userId]);
    await expect(service.apply(fixture.batchId, plan, fixture.actor)).rejects.toMatchObject({ kind: "forbidden" });
    expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
    await expectNoEnrichmentAudit();
  });

  it("replays the exact applied plan after a lost response without changing the item or duplicating audit records", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    const first = await service.apply(fixture.batchId, plan, fixture.actor);
    const afterFirst = await itemState(fixture.itemId);
    const second = await service.apply(fixture.batchId, plan, fixture.actor);
    expect(second).toEqual(first);
    expect(await itemState(fixture.itemId)).toEqual(afterFirst);
    const records = await runtimePool.query<{ count: number }>(`select count(*)::int as count from "yu_inventory"."audit_records" where action='item.audit_enrichment'`);
    expect(records.rows[0]?.count).toBe(1);
  });

  it("rolls the item update back when its audit record cannot be persisted", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    await migrationPool.query(`create function "yu_inventory".reject_enrichment_audit_test() returns trigger language plpgsql as $$
      begin
        if new.action='item.audit_enrichment' then raise exception 'test_enrichment_audit_unavailable'; end if;
        return new;
      end;
      $$`);
    await migrationPool.query(`create trigger reject_enrichment_audit_test before insert on "yu_inventory"."audit_records"
      for each row execute function "yu_inventory".reject_enrichment_audit_test()`);
    try {
      await expect(service.apply(fixture.batchId, plan, fixture.actor)).rejects.toThrow("test_enrichment_audit_unavailable");
      expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
      await expectNoEnrichmentAudit();
    } finally {
      await migrationPool.query(`drop trigger if exists reject_enrichment_audit_test on "yu_inventory"."audit_records"`);
      await migrationPool.query(`drop function if exists "yu_inventory".reject_enrichment_audit_test()`);
    }
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2 });
  });

  it("returns a recoverable domain conflict if the duplicate policy rejects an apply, with all changes rolled back", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    await migrationPool.query(`create function "yu_inventory".reject_enrichment_name_test() returns trigger language plpgsql as $$
      begin
        raise exception using errcode='23505', message='inventory number duplicate is allowed only for one monitor and one system unit';
      end;
      $$`);
    await migrationPool.query(`create trigger reject_enrichment_name_test before update of name on "yu_inventory"."items"
      for each row execute function "yu_inventory".reject_enrichment_name_test()`);
    try {
      await expect(service.apply(fixture.batchId, plan, fixture.actor)).rejects.toMatchObject({
        kind: "conflict", publicCode: "inventory_audit_enrichment_shared_number_conflict",
      });
      expect(await itemState(fixture.itemId)).toMatchObject({ name: ORIGINAL_NAME, one_c_code: null, version: 1 });
      await expectNoEnrichmentAudit();
    } finally {
      await migrationPool.query(`drop trigger if exists reject_enrichment_name_test on "yu_inventory"."items"`);
      await migrationPool.query(`drop function if exists "yu_inventory".reject_enrichment_name_test()`);
    }
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
  });

  it("serializes simultaneous applications of the same reviewed plan and safely replays after settlement", async () => {
    const fixture = await createFixture();
    const service = new InventoryAuditEnrichmentService(runtimePool);
    const plan = await service.preview(fixture.batchId, fixture.actor);
    const attempts = await Promise.allSettled([
      service.apply(fixture.batchId, plan, fixture.actor),
      service.apply(fixture.batchId, plan, fixture.actor),
    ]);
    expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
    for (const attempt of attempts) {
      if (attempt.status === "fulfilled") {
        expect(attempt.value).toMatchObject({ updated: 1, planHash: plan.planHash });
      } else {
        expect(attempt.reason).toMatchObject({ kind: "conflict", publicCode: "inventory_audit_enrichment_stale" });
      }
    }
    expect((await service.apply(fixture.batchId, plan, fixture.actor)).updated).toBe(1);
    expect(await itemState(fixture.itemId)).toMatchObject({ name: SOURCE_NAME, one_c_code: "00003254", version: 2 });
    const records = await runtimePool.query<{ count: number }>(`select count(*)::int as count from "yu_inventory"."audit_records" where action='item.audit_enrichment'`);
    expect(records.rows[0]?.count).toBe(1);
  });
});

async function createFixture(options: { excelCode?: string; excelOnly?: boolean; oneCOnly?: boolean; duplicateOneC?: boolean; selectedBatchOnly?: boolean; divergentCurrentName?: boolean; divergentCurrentIdentity?: boolean; divergentSelectedIdentity?: boolean; sharedNumberPeer?: boolean; inventoryNumber?: string; sourceName?: string } = {}) {
  const userId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), itemId = randomUUID(), externalId = randomUUID();
  await runtimePool.query(`insert into "yu_inventory"."users"(id,code,email,full_name,role,created_at,updated_at)
    values($1,$2,$3,'Enrichment admin','admin',now(),now())`, [userId, `enrich-${userId.slice(0, 8)}`, `${userId}@example.test`]);
  await runtimePool.query(`insert into "yu_inventory"."buildings"(id,name,name_key,address,address_key,created_by,updated_by)
    values($1,'Enrichment building',$2,'Enrichment address',$2,$3,$3)`, [buildingId, `enrich-${buildingId}`, userId]);
  await runtimePool.query(`insert into "yu_inventory"."rooms"(id,building_id,designation,designation_key,floor_number,created_by,updated_by)
    values($1,$2,'101',$3,1,$4,$4)`, [roomId, buildingId, `enrich-${roomId}`, userId]);
  await runtimePool.query(`insert into "yu_inventory"."items"
    (id,name,item_type,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
    values($1,$2,'electronics',1,100,$3,'official',$5::text,$5::text,$4,$4)`, [itemId, options.sharedNumberPeer ? "Монитор" : ORIGINAL_NAME, roomId, userId, options.inventoryNumber ?? "2411/00388"]);
  if (options.sharedNumberPeer) {
    await runtimePool.query(`insert into "yu_inventory"."items"
      (id,name,item_type,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by,archived_at,archived_by)
      values($1,'Системный блок','electronics',1,100,$2,'official',$4::text,$4::text,$3,$3,now(),$3)`,
    [randomUUID(), roomId, userId, options.inventoryNumber ?? "2411/00388"]);
  }
  const sourceName = options.sourceName ?? (options.inventoryNumber ? SOURCE_NAME.replace("2411/00388", options.inventoryNumber) : SOURCE_NAME);
  await uploadMaterialSnapshot("материалы 2026.xls", materialFile(options.excelCode ?? "00003254", options.oneCOnly ? "Другая запись №9999/00388" : sourceName), userId, runtimePool);
  const asset: OneCFixedAsset = {
    externalId, code: "00003254", inventoryNumber: (options.inventoryNumber ?? "2411/00388").replace("/", ""), barcode: null, name: sourceName, category: null,
    location: null, status: "Принято к учёту", responsibleName: null, responsibleExternalId: null,
    quantity: 1, residualCost: 100, acceptedAt: null, updatedAt: null,
  };
  const selectedAsset = options.excelOnly ? { ...asset, inventoryNumber: "999900388", name: "Другая запись №9999/00388" } : options.divergentSelectedIdentity
    ? { ...asset, code: "00009999", inventoryNumber: "241100389", name: "Ноутбук Lenovo другая запись №2411/00389" } : asset;
  const assets = options.duplicateOneC ? [selectedAsset, { ...selectedAsset, externalId: randomUUID() }] : [selectedAsset];
  const batchId = await saveAssets(assets);
  if (options.selectedBatchOnly) await migrationPool.query(`delete from "yu_inventory"."one_c_fixed_asset_inbox" where external_id=$1`, [externalId]);
  if (options.divergentCurrentName) await saveAssets([{ ...asset, name: "Ноутбук Lenovo новая запись №2411/00388" }]);
  if (options.divergentCurrentIdentity) await saveAssets([{ ...asset, code: "00009999", inventoryNumber: "241100389", name: "Ноутбук Lenovo другая запись №2411/00389" }]);
  if (options.divergentSelectedIdentity) await saveAssets([asset]);
  const batch = await runtimePool.query<{ version: number }>(`select version from "yu_inventory"."one_c_import_batches" where id=$1`, [batchId]);
  const service = new OneCReconciliationService(runtimePool);
  await service.analyzeBatch(batchId, { version: batch.rows[0]!.version });
  const audit = await service.getInventoryAuditPage(batchId, { page: 1, pageSize: 50 });
  expect(audit.data.find((row) => row.itemId === itemId)?.source).toBe(options.excelOnly ? "excel" : options.oneCOnly ? "1c" : "1c+excel");
  if (!options.oneCOnly) expect(audit.data.find((row) => row.itemId === itemId)?.excel[0]?.oneCCode).toBe(options.excelCode ?? "00003254");
  return { userId, itemId, externalId, batchId, asset, actor: { userId, role: "admin" as const, sessionVersion: 1 } };
}

function materialFile(code: string, nomenclature = SOURCE_NAME, quantity = 1): Buffer {
  const header: unknown[] = Array(12).fill("");
  header[1] = "Номенклатура"; header[4] = "Код"; header[11] = "Количество";
  const row: unknown[] = Array(12).fill("");
  row[0] = 1; row[1] = nomenclature; row[4] = code; row[11] = quantity;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, row]), "Лист_1");
  return Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
}

async function saveAssets(assets: OneCFixedAsset[]) {
  const sourceSha256 = createHash("sha256").update(randomUUID()).digest("hex");
  await new PostgresOneCFixedAssetRepository(runtimePool).saveBatch(assets, { requestId: randomUUID(), sourceSha256, sourceFilename: "enrichment.xml" });
  const batch = await runtimePool.query<{ id: string }>(`select id from "yu_inventory"."one_c_import_batches" where source_sha256=$1`, [sourceSha256]);
  return batch.rows[0]!.id;
}

async function itemState(itemId: string) {
  const result = await runtimePool.query(`select name,one_c_code,version,updated_by,updated_at from "yu_inventory"."items" where id=$1`, [itemId]);
  return result.rows[0];
}

async function expectNoEnrichmentAudit() {
  const result = await runtimePool.query<{ count: number }>(`select count(*)::int as count from "yu_inventory"."audit_records" where action='item.audit_enrichment'`);
  expect(result.rows[0]?.count).toBe(0);
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(config, { max: 1 });
  try {
    await pool.query('drop schema if exists "yu_migrations" cascade');
    await pool.query('drop schema if exists "yu_inventory" cascade');
  } finally { await pool.end(); }
}
