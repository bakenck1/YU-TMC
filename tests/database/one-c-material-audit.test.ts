import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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
import { getFixedAssetRegistryPage } from "@/lib/server/one-c-fixed-asset-registry";
import { exportInventorySourceAuditExcel } from "@/lib/server/excel/inventory-source-audit-excel";
import { Workbook } from "exceljs";
import { getOneCAnalytics, getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { exportOneCAnalyticsExcel } from "@/lib/server/excel/one-c-analytics-excel";
import { workbookCell, workbookRow } from "../helpers/one-c-workbook";
import { getOneCMatchedCards } from "@/lib/one-c-matched-cards";
import { buildOneCReconciliationReport } from "@/lib/one-c-reconciliation-report";
import { createPostgresInventoryItemRepositories } from "@/lib/server/persistence/postgres/postgres-inventory-item-repositories";

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

  it.each(["OS", "MP"] as const)("moves all six code-confirmed temporary examples into MP after %s import and reduces unmatched without modifying cards", async (source) => {
    const f = await seed();
    const examples = [
      ["00000012626", "манекен портновский женский от 10.12.24", 2, 29000],
      ["00000012625", "манекен портновский мужской от 10.12.24", 2, 29000],
      ["00000011482", "доска маркерная двухсторонная с подставкой от 04.07.24", 1, 28667],
      ["00000011482", "доска маркерная двухсторонная с подставкой от 04.07.24", 1, 28667],
      ["00000012056", "кресло офисное обивка из ткани от 05.09.24", 59, 15848],
      ["00000011436", "стул школьный без обивки жесткий от 03.06.2024", 6, 8960],
    ] as const;
    const responsibleName = "Сотрудник проверки";
    const responsibleId = await addUser(responsibleName);
    const ids: string[] = [];
    for (const [code, name, quantity, price] of examples) {
      const id = randomUUID();
      ids.push(id);
      await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,one_c_code,created_by,updated_by)
        select $1,$3,$4,$5,room_id,'temporary',$6::text,lower($6::text),$7,created_by,updated_by from yu_inventory.items where id=$2`,
      [id, f.itemId, name, quantity, price, `TMP-2026-${id}`, code]);
      await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`,
        [randomUUID(), id, responsibleId, f.actor.userId]);
    }
    await pool.query(`update yu_inventory.items set inventory_number_kind='temporary',inventory_number='TMP-2026-MISSING',inventory_number_key='tmp-2026-missing' where id=$1`, [f.itemId]);
    const readCards = async () => (await pool.query(`select id,name,inventory_number,inventory_number_kind,one_c_code,quantity,unit_price,version from yu_inventory.items order by id`)).rows;
    const original = await readCards();
    const before = await getOneCAnalyticsSnapshot(pool);
    expect(before.analytics.reconciliation).toMatchObject({ total: 7, materials: 0, temporaryFound: 0, temporaryUnmatched: 7 });

    const unique = [...new Map(examples.map(example => [example[0], example])).values()];
    if (source === "OS") {
      const template = (await pool.query(`select payload from yu_inventory.one_c_fixed_asset_inbox`)).rows[0].payload as OneCFixedAsset;
      await new PostgresOneCFixedAssetRepository(pool).saveBatch(unique.map(([code, name, , price]) => ({
        ...template, externalId: randomUUID(), code, name, inventoryNumber: null, barcode: null, quantity: 1, initialCost: price, responsibleName,
      })), metadata());
    } else {
      await save(unique.map(([code, name, , price]) => ({ ...base, code, name, inventoryNumber: null, unitPrice: String(price), responsibleName })));
    }

    const after = await getOneCAnalyticsSnapshot(pool);
    expect(buildOneCReconciliationReport(after).verified).toBe(true);
    const matched = getOneCMatchedCards(after).filter(card => card.group === "materials");
    expect(after.analytics.reconciliation).toMatchObject({ total: 7, fixedAssets: 0, materials: 6, both: 0, temporaryFound: 6, temporaryUnmatched: 1 });
    expect(matched.map(card => card.id).sort()).toEqual([...ids].sort());
    expect(matched.filter(card => card.oneCCode === "00000011482")).toHaveLength(2);
    for (const [index, [code, , quantity, price]] of examples.entries()) {
      expect(matched.find(card => card.id === ids[index])).toMatchObject({ oneCCode: code, quantity, oneCUnitPrice: `${price}.00`, responsibleName });
    }
    expect(await readCards()).toEqual(original);
    const bytes = await exportOneCAnalyticsExcel(after);
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const mp = workbook.getWorksheet("МП")!;
    expect(mp.rowCount).toBe(5 + after.materialRecords.length + matched.length);
    for (const id of ids) expect(workbookRow(mp, id)).toBeTruthy();
    const temporary = workbook.getWorksheet("Временные")!;
    for (const id of ids) expect(workbookCell(temporary, "Результат сверки", workbookRow(temporary, id).number).value).toBe("Найдено");
    expect(workbookCell(temporary, "Результат сверки", workbookRow(temporary, f.itemId).number).value).toBe("Не найдено");
  });

  it("saves the exact current MOL's MP price when the same code has a different price under another owner", async () => {
    const f = await seed();
    const responsibleName = "Иванов Иван Иванович";
    const responsibleId = await addUser(responsibleName);
    await pool.query(`update yu_inventory.items set one_c_code=$2 where id=$1`, [f.itemId, base.code]);
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [randomUUID(), f.itemId, responsibleId, f.actor.userId]);
    await save([{ ...base, responsibleName, unitPrice: "15000" }, { ...base, responsibleCode: "002", responsibleName: "Петров Петр Петрович", unitPrice: "20000" }]);
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    expect(getOneCMatchedCards(snapshot)[0]).toMatchObject({ id: f.itemId, oneCUnitPrice: "15000.00", currentUnitPrice: "100.00" });
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ price: { changed: true, nextUnitPrice: "15000.00" }, responsibility: { changed: false } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0].unit_price).toBe("15000.00");
  });

  it("lists and exports temporary OS code matches in MP and saves a unanimous price shared by several OS GUIDs", async () => {
    const f = await seed();
    await pool.query(`update yu_inventory.items set inventory_number_kind='temporary',inventory_number='TMP-2026-PRICE',inventory_number_key='tmp-2026-price',one_c_code='OTHER' where id=$1`, [f.itemId]);
    const source = (await pool.query('select payload from yu_inventory.one_c_fixed_asset_inbox')).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...source, initialCost: 50000 }, { ...source, externalId: randomUUID(), name: "Другое ОС того же кода", initialCost: null }], metadata());
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    const list = getOneCMatchedCards(snapshot).filter(card => card.group === "materials");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: f.itemId, oneCUnitPrice: "50000.00", currentUnitPrice: "100.00", source: "ОС" });
    const bytes = await exportOneCAnalyticsExcel(snapshot);
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const mp = workbook.getWorksheet("МП")!;
    expect(workbookCell(mp, "ID карточки").value).toBe(f.itemId);
    expect(workbookCell(mp, "Учётная цена, KZT").value).toBe(50000);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ eligible: true, nextName: "Наше название", price: { changed: true, nextUnitPrice: "50000.00" } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select name,one_c_code,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Наше название", one_c_code: "OTHER", unit_price: "50000.00" });
    expect((await service.previewCurrent(f.actor)).counts.ready).toBe(0);
  });

  it("reviews and updates all current OS and MP without any batch analysis, with atomic audit and replay", async () => {
    const f = await seed();
    const osId = randomUUID();
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      select $1,'Наше ОС',3,250,room_id,'official','999/999','999/999',created_by,updated_by from yu_inventory.items where id=$2`, [osId, f.itemId]);
    await save([base, { ...base, responsibleCode: "002", quantity: "15" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.runId).toBe("current-registry");
    expect(preview.sources).toEqual({ fixedAssets: 1, materials: 1, materialBalances: 2, cards: 2 });
    expect(preview.counts).toEqual({ ready: 2, unchanged: 0, skipped: 0 });
    expect(preview.rows.find(row => row.itemId === f.itemId)).toMatchObject({ nameSource: "materials_api", nextCode: base.code });
    expect(preview.rows.find(row => row.itemId === osId)).toMatchObject({ nameSource: "1c", nextName: "Другое ОС" });
    expect((await pool.query('select name from yu_inventory.items where id=$1', [f.itemId])).rows[0].name).toBe("Наше название");
    expect((await pool.query('select count(*)::int count from yu_inventory.inventory_source_audit_runs')).rows[0].count).toBe(0);
    const result = await service.applyCurrent(preview, f.actor);
    expect(result.updated).toBe(2);
    expect(await service.applyCurrent(preview, f.actor)).toEqual(result);
    const cards = (await pool.query('select id,name,one_c_code,version,inventory_number,quantity,unit_price from yu_inventory.items order by id')).rows;
    expect(cards.find(row => row.id === f.itemId)).toMatchObject({ name: base.name, one_c_code: base.code, version: 2, inventory_number: base.inventoryNumber, quantity: 1, unit_price: "9100.00" });
    expect(cards.find(row => row.id === osId)).toMatchObject({ name: "Другое ОС", one_c_code: "OTHER", version: 2, quantity: 3 });
    const records = await pool.query(`select metadata from yu_inventory.audit_records where action='item.audit_enrichment'`);
    expect(records.rows).toHaveLength(2);
    expect(records.rows.every(row => row.metadata.scope === "current_registry" && row.metadata.batchId === null)).toBe(true);
    expect((await service.previewCurrent(f.actor)).counts).toEqual({ ready: 0, unchanged: 2, skipped: 0 });
  });

  it("applies a matched MP price even when the name and code come from OS without an initial cost", async () => {
    const f = await seed();
    const source = (await pool.query('select payload from yu_inventory.one_c_fixed_asset_inbox')).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...source, inventoryNumber: base.inventoryNumber }], metadata());
    await save([base]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ nameSource: "1c", nextName: source.name, price: { source: "material_unit_price", nextUnitPrice: "9100.00", changed: true } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select name,one_c_code,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: source.name, one_c_code: source.code, unit_price: "9100.00" });
    expect((await service.previewCurrent(f.actor)).counts.ready).toBe(0);
  });

  it("writes only price when OS and MP share a permanent card's code and the available price agrees", async () => {
    const f = await seed();
    await pool.query(`update yu_inventory.items set one_c_code='OTHER' where id=$1`, [f.itemId]);
    await save([{ ...base, code: "OTHER", name: "Материал", inventoryNumber: null }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.counts).toEqual({ ready: 1, unchanged: 0, skipped: 0 });
    expect(preview.rows[0]).toMatchObject({ eligible: true, nextName: "Наше название", nextCode: "OTHER", price: { source: "material_unit_price", nextUnitPrice: "9100.00" } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select name,one_c_code,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Наше название", one_c_code: "OTHER", unit_price: "9100.00" });
    expect((await pool.query(`select metadata->'price' as price from yu_inventory.audit_records where action='item.audit_enrichment' and subject_id=$1`, [f.itemId])).rows[0].price).toMatchObject({ source: "material_unit_price", sourceMaterialCode: "OTHER", nextUnitPrice: "9100.00" });
    expect((await service.previewCurrent(f.actor)).counts.ready).toBe(0);
  });

  it("matches multiple temporary cards by full name and current non-whitelisted owner, then updates the selected MP code/name/price", async () => {
    const f = await seed();
    const responsibleName = "Иванов Иван Иванович";
    const responsibleId = await addUser(responsibleName);
    const otherId = randomUUID();
    const name = "Шкаф 800*400*2000";
    await pool.query(`update yu_inventory.items set name=$2,inventory_number_kind='temporary',inventory_number='TMP-2026-000001',inventory_number_key='tmp-2026-000001',one_c_code=null where id=$1`, [f.itemId, name]);
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      select $1,name,1,100,room_id,'temporary','TMP-2026-000002','tmp-2026-000002',created_by,updated_by from yu_inventory.items where id=$2`, [otherId, f.itemId]);
    for (const itemId of [f.itemId, otherId]) await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by)
      values($1,$2,$3,'admin_override',$4)`, [randomUUID(), itemId, responsibleId, f.actor.userId]);
    await save([
      { ...base, code: "0000000100", name: "ШКАФ 800*400*2000", inventoryNumber: null, unitPrice: "7450", responsibleName },
      { ...base, code: "0000000001", name, inventoryNumber: null, unitPrice: "0", responsibleName },
      { ...base, code: "0000000002", name, inventoryNumber: null, unitPrice: "9999", responsibleName: "Петров Петр Петрович" },
    ]);
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    expect(snapshot.analytics.reconciliation).toMatchObject({ total: 2, materials: 2, temporaryFound: 2, temporaryUnmatched: 0 });
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.counts).toEqual({ ready: 2, unchanged: 0, skipped: 0 });
    for (const row of preview.rows) expect(row).toMatchObject({ eligible: true, identityMethod: "name_owner", nextName: "ШКАФ 800*400*2000", nextCode: "0000000100", price: { nextUnitPrice: "7450.00", changed: true }, responsibility: { changed: false } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(2);
    const cards = (await pool.query(`select name,one_c_code,unit_price from yu_inventory.items order by id`)).rows;
    expect(cards).toEqual(Array.from({ length: 2 }, () => ({ name: "ШКАФ 800*400*2000", one_c_code: "0000000100", unit_price: "7450.00" })));
    expect((await pool.query(`select responsible_user_id from yu_inventory.responsibility_periods where ended_at is null`)).rows).toEqual(Array.from({ length: 2 }, () => ({ responsible_user_id: responsibleId })));
  });

  it("selects an active priced source across OS and MP and keeps its price with its code", async () => {
    const f = await seed();
    const name = "Стол офисный";
    const responsibleName = "Иванов Иван Иванович";
    const responsibleId = await addUser(responsibleName);
    await pool.query(`update yu_inventory.items set name=$2,inventory_number_kind='temporary',inventory_number='TMP-2026-000001',inventory_number_key='tmp-2026-000001',one_c_code=null where id=$1`, [f.itemId, name]);
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [randomUUID(), f.itemId, responsibleId, f.actor.userId]);
    const original = (await pool.query(`select payload from yu_inventory.one_c_fixed_asset_inbox`)).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...original, name, code: "A-OS", inventoryNumber: null, barcode: null, responsibleName, initialCost: 5700, status: "Не в учёте" }], metadata());
    await save([{ ...base, name, code: "B-MP", inventoryNumber: null, responsibleName, unitPrice: "8100" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ identityMethod: "name_owner", nameSource: "materials_api", nextCode: "B-MP", price: { nextUnitPrice: "8100.00" } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query(`select one_c_code,unit_price from yu_inventory.items where id=$1`, [f.itemId])).rows[0]).toEqual({ one_c_code: "B-MP", unit_price: "8100.00" });
  });

  it("invalidates a name-owner preview when the current owner's full name changes without an item version change", async () => {
    const f = await seed();
    const responsibleName = "Иванов Иван Иванович";
    const responsibleId = await addUser(responsibleName);
    await pool.query(`update yu_inventory.items set name='Стол',inventory_number_kind='temporary',inventory_number='TMP-2026-000001',inventory_number_key='tmp-2026-000001',one_c_code=null where id=$1`, [f.itemId]);
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [randomUUID(), f.itemId, responsibleId, f.actor.userId]);
    await save([{ ...base, name: "Стол", inventoryNumber: null, responsibleName: responsibleName ?? undefined }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ eligible: true, identityMethod: "name_owner" });
    await pool.query(`update yu_inventory.users set full_name='Петров Петр Петрович' where id=$1`, [responsibleId]);
    await expect(service.applyCurrent(preview, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    expect((await pool.query(`select one_c_code,unit_price,version from yu_inventory.items where id=$1`, [f.itemId])).rows[0]).toEqual({ one_c_code: null, unit_price: "100.00", version: 1 });
  });

  it("writes the chosen OS code, full source name and initial cost from a matching current owner", async () => {
    const f = await seed();
    const responsibleName = "Серикбаев Алихан Ерланович";
    const responsibleId = await addUser(responsibleName);
    await pool.query(`update yu_inventory.items set name='Стол офисный',inventory_number_kind='temporary',inventory_number='TMP-2026-000001',inventory_number_key='tmp-2026-000001',one_c_code=null where id=$1`, [f.itemId]);
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [randomUUID(), f.itemId, responsibleId, f.actor.userId]);
    const original = (await pool.query(`select payload from yu_inventory.one_c_fixed_asset_inbox`)).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([
      { ...original, name: "СТОЛ ОФИСНЫЙ", code: "A-OS", inventoryNumber: null, barcode: null, responsibleName, initialCost: 13750 },
      { ...original, externalId: randomUUID(), name: "Стол офисный", code: "B-OS", inventoryNumber: null, barcode: null, responsibleName, initialCost: 9990 },
    ], metadata());
    await save([{ ...base, name: "Стол офисный", code: "C-MP", inventoryNumber: null, responsibleName, unitPrice: "8100" }]);
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    expect(snapshot.analytics.reconciliation).toMatchObject({ fixedAssets: 0, materials: 1, temporaryFound: 1 });
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ identityMethod: "name_owner", nameSource: "1c", nextName: "СТОЛ ОФИСНЫЙ", nextCode: "A-OS", price: { source: "os_initial_cost", nextUnitPrice: "13750.00" }, responsibility: { changed: false } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query(`select name,one_c_code,unit_price from yu_inventory.items where id=$1`, [f.itemId])).rows[0]).toEqual({ name: "СТОЛ ОФИСНЫЙ", one_c_code: "A-OS", unit_price: "13750.00" });
    expect((await service.previewCurrent(f.actor)).counts.ready).toBe(0);
  });

  it.each([null, "", "Петров Петр Петрович"])("does not use matching full names with missing or different source owner %s", async (responsibleName) => {
    const f = await seed();
    const responsibleId = await addUser("Иванов Иван Иванович");
    await pool.query(`update yu_inventory.items set name='Стол',inventory_number_kind='temporary',inventory_number='TMP-2026-000001',inventory_number_key='tmp-2026-000001',one_c_code=null where id=$1`, [f.itemId]);
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [randomUUID(), f.itemId, responsibleId, f.actor.userId]);
    await save([{ ...base, name: "Стол", inventoryNumber: null, responsibleName: responsibleName ?? undefined }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ eligible: false, nextCode: null, price: { changed: false } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(0);
    expect((await getOneCAnalytics(pool)).analytics.reconciliation).toMatchObject({ temporaryFound: 0, temporaryUnmatched: 1 });
  });

  it.each(["Стол", "шкаф 800*400*2000 от 09.10.24"])("keeps anonymous temporary %s unmatched across analytics, export and apply", async (name) => {
    const f = await seed();
    const temporary = "TMP-2026-146DA4E0E63108AFC77B";
    await pool.query(`update yu_inventory.items set name=$2,inventory_number_kind='temporary',inventory_number=$3::text,inventory_number_key=lower($3::text),one_c_code=null where id=$1`, [f.itemId, name, temporary]);
    const original = (await pool.query("select payload from yu_inventory.one_c_fixed_asset_inbox")).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...original, name, code:"000004741", inventoryNumber:null, barcode:null, status:"Не в учёте", initialCost:5000 }], metadata());
    await save([{...base,name,inventoryNumber:null,barcode:null,unitPrice:"5000"}]);
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    expect(snapshot.analytics.reconciliation).toMatchObject({total:1,fixedAssets:0,materials:0,both:0,temporary:1,temporaryFound:0,temporaryUnmatched:1});
    const service = new InventoryAuditEnrichmentService(pool);
    const plan = await service.previewCurrent(f.actor);
    expect(plan.rows[0]).toMatchObject({eligible:false,nextCode:null,price:{changed:false}});
    expect((await service.applyCurrent(plan,f.actor)).updated).toBe(0);
    expect((await pool.query("select one_c_code,unit_price from yu_inventory.items where id=$1",[f.itemId])).rows[0]).toEqual({one_c_code:null,unit_price:"100.00"});
    const workbook = new Workbook();
    const bytes = await exportOneCAnalyticsExcel(snapshot);
    await workbook.xlsx.load(Buffer.from(bytes));
    expect(workbook.getWorksheet("Совпадения 1С")!.rowCount).toBe(5);
    expect(workbookCell(workbook.getWorksheet("Временные")!, "Результат сверки").value).toBe("Не найдено");
  });

  it("does not confirm or change price from a unique material name without an identifier", async () => {
    const f = await seed();
    await pool.query('update yu_inventory.items set name=$2 where id=$1', [f.itemId, "Unique printer"]);
    await save([{ ...base, name: "UNIQUE  printer", inventoryNumber: null }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ eligible: false, nextName: "Unique printer", nextCode: null, price: { changed: false }, responsibility: { changed: false } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(0);
    expect((await pool.query('select name,one_c_code,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Unique printer", one_c_code: null, unit_price: "100.00" });
    expect((await getOneCAnalytics(pool)).analytics.reconciliation.materials).toBe(0);
  });

  it("writes the reported cabinet code and price when its identifier is in the site name", async () => {
    const f = await seed();
    await pool.query('update yu_inventory.items set name=$2 where id=$1', [f.itemId, "шкаф-купе д/документов No1350*16355 от 09.10.2024"]);
    await save([{ ...base, code: "00000013205", name: "шкаф-купе д/документов №1350/16355 от 09.10.2024", inventoryNumber: null, unitPrice: "86955", quantity: "1" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows.find(row => row.itemId === f.itemId)).toMatchObject({ eligible: true, nextCode: "00000013205", price: { changed: true, nextUnitPrice: "86955.00" } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select one_c_code,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ one_c_code: "00000013205", unit_price: "86955.00" });
    expect((await service.previewCurrent(f.actor)).counts.ready).toBe(0);
  });

  it("confirms and updates temporary cards from their exact MP code without inventory identifiers", async () => {
    const f = await seed();
    await pool.query(`update yu_inventory.items set inventory_number_kind='temporary',inventory_number='TMP-2026-000001',inventory_number_key='tmp-2026-000001',one_c_code=$2 where id=$1`, [f.itemId, base.code]);
    await save([{ ...base, name: "Материальный предмет", inventoryNumber: null, barcode: null }]);
    const before = await getOneCAnalytics(pool);
    expect(before.analytics.reconciliation).toMatchObject({ materials: 1, temporary: 1, temporaryUnmatched: 0, temporaryFound: 1, temporaryPossible: 0 });
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows.find(row => row.itemId === f.itemId)).toMatchObject({ eligible: true, identityMethod: "material_code", nameSource: "materials_api", nextName: "Материальный предмет", price: { nextUnitPrice: "9100.00", changed: true }, responsibility: { changed: false } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select name,one_c_code,unit_price,inventory_number_kind from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Материальный предмет", one_c_code: base.code, unit_price: "9100.00", inventory_number_kind: "temporary" });
    expect((await service.previewCurrent(f.actor)).counts.ready).toBe(0);
  });

  it("checks all temporary cards against OS and MP and applies each register's own name and price", async () => {
    const f = await seed();
    const source = (await pool.query('select payload from yu_inventory.one_c_fixed_asset_inbox')).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...source, initialCost: 50000, status: "Снято с учёта" }], metadata());
    await pool.query(`update yu_inventory.items set inventory_number_kind='temporary',inventory_number='TMP-2026-000001',inventory_number_key='tmp-2026-000001',one_c_code='OTHER' where id=$1`, [f.itemId]);
    const mpId = randomUUID();
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,one_c_code,created_by,updated_by)
      select $1,'Наш МП',1,0,room_id,'temporary','TMP-2026-000002','tmp-2026-000002',$3,created_by,updated_by from yu_inventory.items where id=$2`, [mpId, f.itemId, base.code]);
    await save([{ ...base, name: "Название МП", inventoryNumber: null, barcode: null }]);
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    expect(snapshot.analytics.reconciliation).toMatchObject({ fixedAssets: 0, materials: 2, both: 0, temporary: 2, temporaryUnmatched: 0, temporaryFound: 2, temporaryPossible: 0 });
    const bytes = await exportOneCAnalyticsExcel(snapshot);
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    for (const name of ["Совпадения 1С", "Временные"]) {
      const sheet = workbook.getWorksheet(name)!;
      const osRow = workbookRow(sheet, f.itemId).number;
      expect(workbookCell(sheet, "Раздел 1С", osRow).value).toBe("МП");
      expect(workbookCell(sheet, "Первоначальная стоимость ОС, KZT", osRow).value).toBe(50000);
    }
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows.find(row => row.itemId === f.itemId)).toMatchObject({ identityMethod: "asset_code", nextName: source.name, price: { nextUnitPrice: "50000.00" } });
    expect(preview.rows.find(row => row.itemId === mpId)).toMatchObject({ identityMethod: "material_code", nextName: "Название МП", price: { nextUnitPrice: "9100.00" } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(2);
    expect((await pool.query('select name,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: source.name, unit_price: "50000.00" });
    expect((await pool.query('select name,unit_price from yu_inventory.items where id=$1', [mpId])).rows[0]).toEqual({ name: "Название МП", unit_price: "9100.00" });
    expect((await service.previewCurrent(f.actor)).counts.ready).toBe(0);
  });

  it("rejects whole-registry changes after preview, including source-only changes", async () => {
    const f = await seed();
    await save([base]);
    const service = new InventoryAuditEnrichmentService(pool);
    const first = await service.previewCurrent(f.actor);
    await save([{ ...base, unitPrice: "9200" }], "2026-10-21T01:00:00Z");
    await expect(service.applyCurrent(first, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    const second = await service.previewCurrent(f.actor);
    await pool.query("update yu_inventory.items set name='Изменено вручную',version=version+1 where id=$1", [f.itemId]);
    await expect(service.applyCurrent(second, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    expect((await pool.query('select name,one_c_code from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Изменено вручную", one_c_code: null });
  });

  it("preserves conflicting material metadata while allowing a unanimous price for the identified code", async () => {
    const f = await seed();
    await save([base, { ...base, responsibleCode: "002", name: "Другой предмет", inventoryNumber: "1350/55555" }]);
    const preview = await new InventoryAuditEnrichmentService(pool).previewCurrent(f.actor);
    expect(preview.counts).toEqual({ ready: 1, unchanged: 0, skipped: 0 });
    expect(preview.rows[0]).toMatchObject({ nextName: "Наше название", nextCode: null, price: { changed: true, nextUnitPrice: "9100.00" }, responsibility: { changed: false } });
  });

  it("previews and applies exact unit prices with audit, while stale site prices cannot be overwritten", async () => {
    const f = await seed();
    await save([base]);
    await pool.query('update yu_inventory.items set name=$2,one_c_code=$3 where id=$1', [f.itemId, base.name, base.code]);
    const service = new InventoryAuditEnrichmentService(pool);
    const first = await service.previewCurrent(f.actor);
    expect(first.rows[0].price).toMatchObject({ currentUnitPrice: "100.00", nextUnitPrice: "9100.00", changed: true, status: "ready" });
    expect(first.counts.ready).toBe(1);
    await pool.query('update yu_inventory.items set unit_price=200 where id=$1', [f.itemId]);
    await expect(service.applyCurrent(first, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    const fresh = await service.previewCurrent(f.actor);
    const result = await service.applyCurrent(fresh, f.actor);
    expect(await service.applyCurrent(fresh, f.actor)).toEqual(result);
    expect((await pool.query('select unit_price,version from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ unit_price: "9100.00", version: 2 });
    const audit = (await pool.query(`select before_values,after_values from yu_inventory.audit_records where action='item.audit_enrichment'`)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before_values: { unitPrice: "200.00" }, after_values: { unitPrice: "9100.00" } });
  });

  it("maps complete MOL names to the approved short site user for all matching material cards", async () => {
    const f = await seed();
    const bau = await addUser("Бауыржан Тынымбаев");
    const second = randomUUID();
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      select $1,'Второй ноутбук',1,100,room_id,'official','2411/00391','2411/00391',created_by,updated_by from yu_inventory.items where id=$2`, [second, f.itemId]);
    await save([
      { ...base, responsibleName: "Тынымбаев Бауыржан Анесович" },
      { ...base, code: "SECOND", inventoryNumber: null, name: "Ноутбук Lenovo IdeaPad №2411/00391", responsibleName: "Тынымбаев Бауыржан Анесович" },
    ]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.every(row => row.responsibility?.nextUserId === bau && row.responsibility.changed)).toBe(true);
    await service.applyCurrent(preview, f.actor);
    expect((await pool.query('select count(*)::int count from yu_inventory.responsibility_periods where responsible_user_id=$1 and ended_at is null', [bau])).rows[0].count).toBe(2);
  });

  it("uses initial OS cost for one asset and preserves price when only residual cost is supplied", async () => {
    const f = await seed();
    await pool.query(`update yu_inventory.items set inventory_number='999/999',inventory_number_key='999/999' where id=$1`, [f.itemId]);
    const service = new InventoryAuditEnrichmentService(pool);
    const missing = await service.previewCurrent(f.actor);
    expect(missing.rows[0].price).toMatchObject({ status: "missing", nextUnitPrice: "100.00", changed: false });
    await pool.query(`update yu_inventory.one_c_fixed_asset_inbox set payload=jsonb_set(payload,'{initialCost}','56789.12'::jsonb)`);
    const priced = await service.previewCurrent(f.actor);
    expect(priced.rows[0].price).toMatchObject({ status: "ready", nextUnitPrice: "56789.12", source: "os_initial_cost" });
    await service.applyCurrent(priced, f.actor);
    expect((await pool.query('select unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0].unit_price).toBe("56789.12");
    await pool.query(`update yu_inventory.one_c_fixed_asset_inbox set payload=jsonb_set(payload,'{quantity}','2'::jsonb)`);
    const aggregate = await service.previewCurrent(f.actor);
    expect(aggregate.rows[0].price).toMatchObject({ status: "ambiguous", changed: false, nextUnitPrice: "56789.12" });
  });

  it("only active cards enter proposals while the whole current OS register is searched", async () => {
    const f = await seed();
    await save([base]);
    await pool.query(`update yu_inventory.one_c_fixed_asset_inbox set payload=jsonb_set(payload,'{status}','"Снято с учёта"'::jsonb)`);
    await pool.query(`update yu_inventory.items set status='maintenance' where id=$1`, [f.itemId]);
    const preview = await new InventoryAuditEnrichmentService(pool).previewCurrent(f.actor);
    expect(preview.sources.fixedAssets).toBe(1);
    expect(preview.sources.cards).toBe(0);
    expect(preview.rows).toHaveLength(0);
  });

  it("counts live sources and distinct cards without saving a dry-run or adding balances to card totals", async () => {
    const f = await seed();
    await save([base, { ...base, responsibleCode: "002", quantity: "15" }, { ...base, code: "ZERO", quantity: "0" }]);
    const first = await getOneCAnalytics(pool);
    expect(first.analytics.assets).toMatchObject({ total: 1, active: 1, retired: 0 });
    expect(first.materials).toMatchObject({ materialCount: 1, rowCount: 2, positiveRows: 2 });
    expect(first.analytics.inventory).toEqual({ total: 1, active: 1, quantity: 1 });
    expect(first.analytics.reconciliation).toMatchObject({ total: 1, materials: 1, missing: 0, assetsWithoutCandidate: 1, materialBalancesWithoutCandidate: 0 });
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    const workbook = new Workbook();
    const bytes = await exportOneCAnalyticsExcel(snapshot);
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["ОС", "МП", "Совпадения 1С", "Временные", "Не найдено в 1С", "Добавить в базу"]);
    expect(workbook.getWorksheet("МП")!.rowCount).toBe(8);
    expect(workbookCell(workbook.getWorksheet("Совпадения 1С")!, "ID карточки").value).toBe(f.itemId);
    expect(workbook.getWorksheet("Совпадения 1С")!.rowCount).toBe(6);
    expect(workbook.getWorksheet("Добавить в базу")!.rowCount).toBe(6);
    expect(workbookCell(workbook.getWorksheet("Добавить в базу")!, "Код 1С").value).toBe("OTHER");
    expect((await pool.query('select count(*)::int as count from yu_inventory.inventory_source_audit_runs')).rows[0].count).toBe(0);
    await pool.query('update yu_inventory.items set archived_at=now(), archived_by=created_by where id=$1', [f.itemId]);
    const second = await getOneCAnalytics(pool);
    expect(second.analytics.inventory.total).toBe(0);
    expect(second.analytics.reconciliation.materialBalancesWithoutCandidate).toBe(2);
    const afterArchive = new Workbook();
    const afterArchiveBytes = await exportOneCAnalyticsExcel(await getOneCAnalyticsSnapshot(pool));
    await afterArchive.xlsx.load(afterArchiveBytes.buffer.slice(afterArchiveBytes.byteOffset, afterArchiveBytes.byteOffset + afterArchiveBytes.byteLength) as ArrayBuffer);
    expect(afterArchive.getWorksheet("Добавить в базу")!.rowCount).toBe(8);
  });

  it("keeps active stock totals but reconciles all OS and all nonarchived cards", async () => {
    const f = await seed();
    await save([base, { ...base, code: "ZERO", quantity: "0" }, { ...base, code: "NEGATIVE", quantity: "-1" }]);
    const source = (await pool.query('select payload from yu_inventory.one_c_fixed_asset_inbox')).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([
      { ...source, externalId: randomUUID(), code: "RETIRED", inventoryNumber: base.inventoryNumber, status: "Снято с учёта" },
      { ...source, externalId: randomUUID(), code: "OTHER-STATUS", inventoryNumber: base.inventoryNumber, status: null },
    ]);
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,status,created_by,updated_by)
      select $1,'Неактивная карточка',9,250,room_id,'official','999/999','999/999','maintenance',created_by,updated_by from yu_inventory.items where id=$2`, [randomUUID(), f.itemId]);
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    expect(snapshot.analytics.assets).toMatchObject({ total: 1, active: 1, retired: 0, other: 0 });
    expect(snapshot.materials).toMatchObject({ materialCount: 1, rowCount: 1, positiveRows: 1, nonPositiveRows: 0 });
    expect(snapshot.analytics.inventory).toEqual({ total: 2, active: 1, quantity: 10 });
    expect(snapshot.analytics.reconciliation).toMatchObject({ total: 2, materials: 0, fixedAssets: 1, both: 1, possible: 0 });
    expect(snapshot.registryAssets).toHaveLength(3);
    const materialPage = await getMaterialRegistryPage({ page: 1, pageSize: 50 }, pool);
    expect(materialPage.total).toBe(snapshot.materials.rowCount);
    expect(materialPage.data).toHaveLength(1);
    expect(materialPage.data[0].payload.code).toBe(base.code);
    const assetPage = await getFixedAssetRegistryPage({ page: 1, pageSize: 50 }, pool);
    expect(assetPage.total).toBe(snapshot.analytics.assets.total);
    expect(assetPage.data).toHaveLength(1);
    expect(assetPage.data[0].payload.code).toBe("OTHER");
    const workbook = new Workbook();
    const bytes = await exportOneCAnalyticsExcel(snapshot);
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(workbook.getWorksheet("ОС")!.rowCount).toBe(6);
    expect(workbook.getWorksheet("МП")!.rowCount).toBe(7);
    const found = workbook.getWorksheet("Совпадения 1С")!;
    expect(found.rowCount).toBe(7);
    const foundRow = workbookRow(found, f.itemId).number;
    expect(workbookCell(found, "Цена в нашей базе, KZT", foundRow).value).toBe(100);
    expect(workbookCell(found, "Статусы ОС в 1С", foundRow).value).toContain("Снято с учёта");
  });

  it("updates a uniquely identified MP despite spaces and punctuation, and keeps unmatched temporary cards separate", async () => {
    const f = await seed();
    await save([{ ...base, inventoryNumber: "1350 14444", name: "Принтер №1350.14444" }]);
    const tempId = randomUUID();
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      select $1,'Временный предмет',1,250,room_id,'temporary','TMP-2026-FORMAT','TMP-2026-FORMAT',created_by,updated_by from yu_inventory.items where id=$2`, [tempId, f.itemId]);
    const overview = await getOneCAnalyticsSnapshot(pool);
    expect(overview.analytics.reconciliation).toMatchObject({ total: 2, materials: 1, missing: 0, temporary: 1, temporaryUnmatched: 1, temporaryFound: 0, temporaryPossible: 0 });
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows.find(row => row.itemId === f.itemId)).toMatchObject({ eligible: true, nextName: "Принтер №1350.14444", price: { nextUnitPrice: "9100.00" } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select name,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Принтер №1350.14444", unit_price: "9100.00" });
    const bytes = await exportOneCAnalyticsExcel(overview);
    const workbook = new Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(workbook.getWorksheet("Не найдено в 1С")!.rowCount).toBe(5);
    expect(workbookCell(workbook.getWorksheet("Временные")!, "ID карточки").value).toBe(tempId);
  });

  it("runs the maintenance CLI as preview or apply and reports missing accounts without silently assigning them", async () => {
    const f = await seed();
    const recipient = await addUser("Иванов Иван Иванович");
    await save([{ ...base, responsibleName: "Иванов Иван Иванович\nмол" }]);
    const run = (...args: string[]) => spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/db/fill-one-c-responsibles.ts", "--target=test", ...args], { encoding: "utf8", windowsHide: true });
    const preview = run();
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({ mode: "preview", actorId: f.actor.userId, checked: 1, updated: 0, remainingReady: 1 });
    expect((await pool.query(`select count(*)::int count from yu_inventory.responsibility_periods`)).rows[0].count).toBe(0);
    const denied = run("--apply", `--actor-id=${recipient}`);
    expect(denied.status).toBe(1);
    expect(denied.stderr).toContain("active_admin_required");
    const applied = run("--apply", `--actor-id=${f.actor.userId}`);
    expect(applied.status, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ mode: "apply", updated: 1, remainingReady: 0, responsibilityCounts: { unchanged: 1 }, missingAccounts: [] });
    const repeated = run("--apply");
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(JSON.parse(repeated.stdout).updated).toBe(0);
    await pool.query(`update yu_inventory.items set inventory_number='1350/55555',inventory_number_key='1350/55555' where id=$1`, [f.itemId]);
    const unowned = randomUUID();
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      select $1,'Предмет без аккаунта',1,100,room_id,'official','1350/14444','1350/14444',created_by,updated_by from yu_inventory.items where id=$2`, [unowned, f.itemId]);
    await save([{ ...base, responsibleName: "Нет Такого Аккаунта\nмол" }], "2026-10-20T01:00:00Z");
    const missing = run("--apply");
    expect(missing.status, missing.stderr).toBe(0);
    expect(JSON.parse(missing.stdout)).toMatchObject({ updated: 0, remainingReady: 0, responsibilityCounts: { unchanged: 1, user_missing: 1 }, missingAccounts: [{ sourceName: "Нет Такого Аккаунта\nмол", items: 1 }] });
    expect((await pool.query(`select count(*)::int count from yu_inventory.responsibility_periods where item_id=$1`, [unowned])).rows[0].count).toBe(0);
  });

  it.each([["OS", "general"], ["MP", "general"], ["OS", "it"], ["MP", "it"]] as const)("backfills a %s MOL-labelled owner in %s by complete number without changing other card fields", async (source, section) => {
    const f = await seed();
    const name = "Мустапаева Сезим Нурахметовна";
    const recipient = await addUser(name);
    await pool.query(`update yu_inventory.items set name='Монитор',item_section=$2,inventory_number='2411/0725',inventory_number_key='2411/0725' where id=$1`, [f.itemId, section]);
    if (source === "OS") {
      const original = (await pool.query(`select payload from yu_inventory.one_c_fixed_asset_inbox`)).rows[0].payload as OneCFixedAsset;
      await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...original, code: "000006283", inventoryNumber: "2411/0725", name: "Монитор 2411/0725 от 10.05.2023", responsibleName: name + "\nмол", initialCost: 50000 }], metadata());
    } else {
      await save([{ ...base, code: "000006283", inventoryNumber: "2411/0725", name: "Монитор 2411/0725 от 10.05.2023", responsibleName: name + " (МОЛ)" }]);
    }
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewMissingResponsibilities(f.actor);
    expect(preview.counts).toEqual({ ready: 1, unchanged: 0, skipped: 0 });
    expect(preview.rows[0]).toMatchObject({ nextName: "Монитор", nextCode: null, responsibility: { nextUserId: recipient } });
    expect((await pool.query(`select count(*)::int count from yu_inventory.responsibility_periods`)).rows[0].count).toBe(0);
    expect(await service.fillMissingResponsibilities(f.actor)).toMatchObject({ updated: 1 });
    expect((await pool.query(`select name,one_c_code,unit_price,inventory_number,item_section,version from yu_inventory.items where id=$1`, [f.itemId])).rows[0])
      .toEqual({ name: "Монитор", one_c_code: null, unit_price: "100.00", inventory_number: "2411/0725", item_section: section, version: 2 });
    const repository = createPostgresInventoryItemRepositories(pool).items;
    const visible = section === "general" ? await repository.listItemsAssignedTo(recipient) : await repository.listItItems();
    expect(visible.find(item => item.id === f.itemId)).toMatchObject({ responsibleId: recipient, responsibleName: name });
    expect(await service.fillMissingResponsibilities(f.actor)).toMatchObject({ updated: 0, unchanged: 1, responsibilityCounts: { unchanged: 1 } });
    expect((await pool.query(`select responsible_user_id from yu_inventory.responsibility_periods where item_id=$1 and ended_at is null`, [f.itemId])).rows).toEqual([{ responsible_user_id: recipient }]);
    expect((await pool.query(`select after_values->>'origin' as origin from yu_inventory.audit_records where subject_kind='responsibility'`)).rows).toEqual([{ origin: "one_c_responsibility_backfill" }]);
  });

  it("fills both vacant owners for a shared monitor/system number without renaming either card", async () => {
    const f = await seed();
    const recipient = await addUser("Сотрудник Полное Имя");
    await pool.query(`update yu_inventory.items set name='Монитор',item_type='electronics' where id=$1`, [f.itemId]);
    const second = randomUUID();
    await pool.query(`insert into yu_inventory.items(id,name,item_type,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      select $1,'Системный блок','electronics',1,100,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by from yu_inventory.items where id=$2`, [second, f.itemId]);
    const original = (await pool.query(`select payload from yu_inventory.one_c_fixed_asset_inbox`)).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...original, inventoryNumber: "1350/14444", name: "Монитор", responsibleName: "Сотрудник Полное Имя мол" }], metadata());
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.counts).toEqual({ ready: 2, unchanged: 0, skipped: 0 });
    expect(preview.rows.every(row => row.nextName === row.currentName && row.nextCode === null && row.responsibility?.nextUserId === recipient)).toBe(true);
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(2);
    expect((await createPostgresInventoryItemRepositories(pool).items.listItemsAssignedTo(recipient)).map(item => item.id).sort()).toEqual([f.itemId, second].sort());
  });

  it.each(["name_invalid", "shared_number_conflict"] as const)("keeps an independently confirmed owner when renaming is blocked by %s", async reason => {
    const f = await seed();
    const recipient = await addUser("Сотрудник Полное Имя");
    if (reason === "shared_number_conflict") {
      await pool.query(`update yu_inventory.items set name='Монитор',item_type='electronics' where id=$1`, [f.itemId]);
      await pool.query(`insert into yu_inventory.items(id,name,item_type,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,archived_at,archived_by,created_by,updated_by)
        select $1,'Системный блок','electronics',1,100,room_id,inventory_number_kind,inventory_number,inventory_number_key,now(),created_by,created_by,updated_by from yu_inventory.items where id=$2`, [randomUUID(), f.itemId]);
    }
    const original = (await pool.query(`select payload from yu_inventory.one_c_fixed_asset_inbox`)).rows[0].payload as OneCFixedAsset;
    await new PostgresOneCFixedAssetRepository(pool).saveBatch([{ ...original, inventoryNumber: "1350/14444", name: reason === "name_invalid" ? "Длинное название ".repeat(15) : "Стол", responsibleName: "Сотрудник Полное Имя\nМОЛ" }], metadata());
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0]).toMatchObject({ eligible: true, changed: true, nextName: reason === "name_invalid" ? "Наше название" : "Монитор", nextCode: null, responsibility: { status: "ready", nextUserId: recipient } });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query(`select name,one_c_code from yu_inventory.items where id=$1`, [f.itemId])).rows[0]).toEqual({ name: preview.rows[0].currentName, one_c_code: null });
  });

  it("fills missing owners across OS and MP, preserving assigned cards and replaying safely", async () => {
    const f = await seed();
    const bau = await addUser("Тынымбаев Бауыржан Анесович");
    const ermek = await addUser("Нурмаганбет Ермек Талантович");
    const old = await addUser("Текущий сотрудник");
    const osId = randomUUID();
    await pool.query(`insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by)
      select $1,'Наше ОС',1,250,room_id,'official','999/999','999/999',created_by,updated_by from yu_inventory.items where id=$2`, [osId, f.itemId]);
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [randomUUID(), f.itemId, old, f.actor.userId]);
    await pool.query(`update yu_inventory.one_c_fixed_asset_inbox set payload=jsonb_set(payload,'{responsibleName}',to_jsonb($1::text))`, ["Тынымбаев Бауыржан Анесович"]);
    await save([{ ...base, responsibleName: "Нурмаганбет Ермек Талантович" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows.find(row => row.itemId === osId)?.responsibility).toMatchObject({ changed: true, nextUserId: bau });
    expect(preview.rows.find(row => row.itemId === f.itemId)?.responsibility).toMatchObject({ currentUserId: old, changed: false, nextUserId: old });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(2);
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(2);
    const periods = (await pool.query('select * from yu_inventory.responsibility_periods order by item_id,started_at')).rows;
    expect(periods).toHaveLength(2);
    expect(periods.find(row => row.responsible_user_id === old)).toMatchObject({ ended_by: null });
    expect(periods.filter(row => row.ended_at === null).map(row => row.responsible_user_id).sort()).toEqual([bau, old].sort());
    expect((await createPostgresInventoryItemRepositories(pool).items.listItemsAssignedTo(ermek))).toHaveLength(0);
    const audits = (await pool.query(`select action,before_values,after_values from yu_inventory.audit_records where subject_kind='responsibility'`)).rows;
    expect(audits).toHaveLength(1);
    expect(audits.every(row => row.action === "responsibility.admin_override")).toBe(true);
    const next = await service.previewCurrent(f.actor);
    expect(next.counts.ready).toBe(0);
    expect(next.rows.every(row => row.responsibility?.status === "unchanged")).toBe(true);
  });

  it.each(["OS", "MP"] as const)("fills an empty responsibility from exact %s code and exposes the item in the recipient account", async source => {
    const f = await seed();
    const fullName = "Иванов Иван Иванович";
    const recipient = await addUser(fullName);
    await pool.query(`update yu_inventory.items set inventory_number_kind='temporary',inventory_number='TMP-2026-OWNER',inventory_number_key='tmp-2026-owner',one_c_code=$2 where id=$1`, [f.itemId, source === "OS" ? "OTHER" : base.code]);
    if (source === "OS") {
      await pool.query(`update yu_inventory.one_c_fixed_asset_inbox set payload=jsonb_set(payload,'{responsibleName}',to_jsonb($1::text))`, [fullName]);
    } else {
      await save([{ ...base, responsibleName: fullName }]);
    }
    const repository = createPostgresInventoryItemRepositories(pool).items;
    expect(await repository.listItemsAssignedTo(recipient)).toHaveLength(0);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0].responsibility).toMatchObject({ currentUserId: null, nextUserId: recipient, changed: true, status: "ready" });
    await service.applyCurrent(preview, f.actor);
    await service.applyCurrent(preview, f.actor);
    const periods = (await pool.query(`select responsible_user_id,ended_at from yu_inventory.responsibility_periods where item_id=$1`, [f.itemId])).rows;
    expect(periods).toEqual([{ responsible_user_id: recipient, ended_at: null }]);
    expect((await repository.listItemsAssignedTo(recipient)).find(item => item.id === f.itemId)).toMatchObject({ responsibleId: recipient });
    const next = await service.previewCurrent(f.actor);
    expect(next.rows[0].responsibility).toMatchObject({ changed: false, currentUserId: recipient, nextUserId: recipient });
    expect(next.counts.ready).toBe(0);
  });

  it("source names and barcode tokens update general and IT cards without structured source numbers", async () => {
    const f = await seed();
    await pool.query(`update yu_inventory.items set item_section='it',it_type='wifi_access_point',item_type='wifi_access_point' where id=$1`, [f.itemId]);
    await save([{ ...base, inventoryNumber: null, name: "Принтер *YUB-1350/14444*", responsibleName: "Другой человек" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.counts.ready).toBe(1);
    expect(preview.rows[0].identityEvidence).toBe("1350/14444");
    expect(preview.rows[0].responsibility?.status).toBe("user_missing");
    await service.applyCurrent(preview, f.actor);
    expect((await pool.query('select name,item_section,one_c_code from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toMatchObject({ name: "Принтер *YUB-1350/14444*", item_section: "it", one_c_code: base.code });
  });

  it("preserves responsibility for any other person and for contradictory MOL balances", async () => {
    const f = await seed();
    const bau = await addUser("Бауыржан Анесович");
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [randomUUID(), f.itemId, bau, f.actor.userId]);
    await save([{ ...base, responsibleName: "Иванов Иван Иванович" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const other = await service.previewCurrent(f.actor);
    expect(other.rows[0].responsibility).toMatchObject({ status: "unchanged", changed: false, nextUserId: bau });
    await service.applyCurrent(other, f.actor);
    await save([{ ...base, responsibleName: "Бауыржан Анесович" }, { ...base, responsibleCode: "002", responsibleName: "Нурмаганбет Ермек Талантович" }], "2026-10-21T01:00:00Z");
    const ambiguous = await service.previewCurrent(f.actor);
    expect(ambiguous.rows[0].responsibility).toMatchObject({ status: "unchanged", changed: false, nextUserId: bau });
    expect((await pool.query('select count(*)::int count from yu_inventory.responsibility_periods where ended_at is null')).rows[0].count).toBe(1);
  });

  it("blocks stale recipient or responsibility changes and leaves all card fields untouched", async () => {
    const f = await seed();
    const bau = await addUser("Бауыржан Анесович");
    await save([{ ...base, responsibleName: "Бауыржан Анесович" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    await pool.query('update yu_inventory.users set is_active=false,deactivated_at=now(),version=version+1 where id=$1', [bau]);
    await expect(service.applyCurrent(preview, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    expect((await pool.query('select name,one_c_code,version from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Наше название", one_c_code: null, version: 1 });
    expect((await pool.query('select count(*)::int count from yu_inventory.responsibility_periods')).rows[0].count).toBe(0);
  });

  it("does not overwrite an owner assigned after the integration preview", async () => {
    const f = await seed();
    await addUser("Иванов Иван Иванович");
    const manual = await addUser("Петров Петр Петрович");
    await save([{ ...base, responsibleName: "Иванов Иван Иванович" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0].responsibility?.changed).toBe(true);
    const periodId = randomUUID();
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [periodId, f.itemId, manual, f.actor.userId]);
    await expect(service.applyCurrent(preview, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    expect((await pool.query(`select id,responsible_user_id,ended_at from yu_inventory.responsibility_periods where item_id=$1`, [f.itemId])).rows).toEqual([{ id: periodId, responsible_user_id: manual, ended_at: null }]);
    expect((await service.previewCurrent(f.actor)).rows[0].responsibility).toMatchObject({ changed: false, currentUserId: manual, nextUserId: manual });
  });

  it("existing responsibilities stay unchanged during and after pending transfers", async () => {
    const f = await seed();
    const bau = await addUser("Бауыржан Анесович");
    const old = await addUser("Прежний сотрудник");
    await pool.query('update yu_inventory.items set name=$2,one_c_code=$3,unit_price=9100 where id=$1', [f.itemId, base.name, base.code]);
    const period = randomUUID();
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$4)`, [period, f.itemId, old, f.actor.userId]);
    await save([{ ...base, responsibleName: "Бауыржан Анесович" }]);
    await pool.query(`insert into yu_inventory.transfers(id,item_id,requested_by,proposed_responsible_id,current_responsible_id_at_request) values($1,$2,$3,$3,$4)`, [randomUUID(), f.itemId, bau, old]);
    const service = new InventoryAuditEnrichmentService(pool);
    const pending = await service.previewCurrent(f.actor);
    expect(pending.counts).toEqual({ ready: 0, unchanged: 1, skipped: 0 });
    expect(pending.rows[0].responsibility?.status).toBe("unchanged");
    await pool.query(`update yu_inventory.transfers set status='cancelled',closed_at=now(),closed_by=$1`, [bau]);
    const ready = await service.previewCurrent(f.actor);
    expect(ready.counts).toEqual({ ready: 0, unchanged: 1, skipped: 0 });
    await service.applyCurrent(ready, f.actor);
    expect((await pool.query('select name,one_c_code,version from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: base.name, one_c_code: base.code, version: 1 });
    expect((await pool.query('select responsible_user_id from yu_inventory.responsibility_periods where ended_at is null')).rows[0].responsible_user_id).toBe(old);
  });

  it("preserves an owner during a current TMC request while still updating the confirmed name and price", async () => {
    const f = await seed();
    const bau = await addUser("Бауыржан Тынымбаев");
    const old = await addUser("Текущий ответственный");
    const periodId = randomUUID();
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by)
      values($1,$2,$3,'admin_override',$4)`, [periodId, f.itemId, old, f.actor.userId]);
    await save([{ ...base, responsibleName: "Тынымбаев Бауыржан Анесович" }]);
    await addPendingTmcRequest(f.itemId, old, bau, periodId);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    expect(preview.rows[0].responsibility).toMatchObject({ changed: false, status: "unchanged", currentUserId: old, nextUserId: old });
    expect(preview.rows[0].price).toMatchObject({ changed: true, nextUnitPrice: "9100.00" });
    expect((await service.applyCurrent(preview, f.actor)).updated).toBe(1);
    expect((await pool.query('select name,unit_price from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: base.name, unit_price: "9100.00" });
    const periods = (await pool.query('select id,responsible_user_id,ended_at from yu_inventory.responsibility_periods where item_id=$1', [f.itemId])).rows;
    expect(periods).toEqual([{ id: periodId, responsible_user_id: old, ended_at: null }]);
  });

  it("rejects a reviewed owner proposal after a current TMC request starts or changes version", async () => {
    const f = await seed();
    const bau = await addUser("Бауыржан Тынымбаев");
    const old = await addUser("Текущий ответственный");
    const periodId = randomUUID();
    await pool.query(`insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by)
      values($1,$2,$3,'admin_override',$4)`, [periodId, f.itemId, old, f.actor.userId]);
    await save([{ ...base, responsibleName: "Тынымбаев Бауыржан Анесович" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const ready = await service.previewCurrent(f.actor);
    expect(ready.rows[0].responsibility?.changed).toBe(false);
    const requestId = await addPendingTmcRequest(f.itemId, old, bau, periodId);
    await expect(service.applyCurrent(ready, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    const pending = await service.previewCurrent(f.actor);
    await pool.query('update yu_inventory.tmc_transfer_requests set version=version+1 where id=$1', [requestId]);
    await expect(service.applyCurrent(pending, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    const changedHeader = await service.previewCurrent(f.actor);
    await pool.query('update yu_inventory.tmc_transfer_request_items set version=version+1 where request_id=$1', [requestId]);
    await expect(service.applyCurrent(changedHeader, f.actor)).rejects.toMatchObject({ publicCode: "inventory_audit_enrichment_stale" });
    expect((await pool.query('select name,unit_price,version from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Наше название", unit_price: "100.00", version: 1 });
  });

  it("rolls back owner history and card updates together if the responsibility audit cannot be saved", async () => {
    const f = await seed();
    await addUser("Бауыржан Анесович");
    await save([{ ...base, responsibleName: "Бауыржан Анесович" }]);
    const service = new InventoryAuditEnrichmentService(pool);
    const preview = await service.previewCurrent(f.actor);
    await owner.query(`create function yu_inventory.reject_one_c_responsibility_audit() returns trigger language plpgsql as $$
      begin if new.action='responsibility.admin_override' then raise exception 'test_responsibility_audit_unavailable'; end if; return new; end $$`);
    await owner.query(`create trigger reject_one_c_responsibility_audit before insert on yu_inventory.audit_records for each row execute function yu_inventory.reject_one_c_responsibility_audit()`);
    try { await expect(service.applyCurrent(preview, f.actor)).rejects.toThrow("test_responsibility_audit_unavailable"); }
    finally {
      await owner.query('drop trigger reject_one_c_responsibility_audit on yu_inventory.audit_records');
      await owner.query('drop function yu_inventory.reject_one_c_responsibility_audit()');
    }
    expect((await pool.query('select name,one_c_code,version from yu_inventory.items where id=$1', [f.itemId])).rows[0]).toEqual({ name: "Наше название", one_c_code: null, version: 1 });
    expect((await pool.query('select count(*)::int count from yu_inventory.responsibility_periods')).rows[0].count).toBe(0);
    expect((await pool.query("select count(*)::int count from yu_inventory.audit_records where action='item.audit_enrichment'")).rows[0].count).toBe(0);
  });

  it("represents absent materials as an unavailable source and counts temporary cards separately", async () => {
    const f = await seed();
    await pool.query("update yu_inventory.items set inventory_number_kind='temporary' where id=$1", [f.itemId]);
    const result = await getOneCAnalytics(pool);
    expect(result.materials.batchId).toBeNull();
    expect(result.analytics.reconciliation).toMatchObject({ total: 1, missing: 0, temporary: 1, temporaryUnmatched: 1, temporaryFound: 0, temporaryPossible: 0 });
  });

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
async function addPendingTmcRequest(itemId: string, initiator: string, recipient: string, periodId: string) {
  const requestId = randomUUID();
  await pool.query(`insert into yu_inventory.tmc_transfer_requests(id,initiator_id,recipient_id) values($1,$2,$3)`, [requestId, initiator, recipient]);
  await pool.query(`insert into yu_inventory.tmc_transfer_request_items(id,request_id,item_id,responsibility_period_id_at_request,current_responsible_id_at_request)
    values($1,$2,$3,$4,$5)`, [randomUUID(), requestId, itemId, periodId, initiator]);
  return requestId;
}
async function addUser(name: string) {
  const id = randomUUID();
  await pool.query(`insert into yu_inventory.users(id,code,email,full_name,role,created_at,updated_at) values($1,$2,$3,$4,'employee',now(),now())`, [id, `user-${id.slice(0, 20)}`, `${id}@example.test`, name]);
  return id;
}
async function save(materials: OneCMaterial[], snapshotAt = "2026-10-19T01:00:00Z") {
  return new PostgresOneCMaterialsRepository(pool).saveSnapshot({ materials, snapshotAt }, metadata());
}
async function reset() {
  if (!config.databaseName.endsWith("_test")) throw new Error("Refusing to reset non-test database");
  const db = createPostgresPool(config, { max: 1 });
  try { await db.query('drop schema if exists "yu_migrations" cascade'); await db.query('drop schema if exists "yu_inventory" cascade'); }
  finally { await db.end(); }
}
