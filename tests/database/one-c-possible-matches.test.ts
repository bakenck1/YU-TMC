import { randomUUID, createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { getOneCPossibleMatches, confirmOneCPossibleMatch } from "@/lib/server/one-c-possible-matches";
import { PostgresOneCMaterialsRepository } from "@/lib/server/persistence/postgres/postgres-one-c-materials-repository";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";

let config: DatabaseConfig, owner: Pool, pool: Pool;
const material: OneCMaterial = { code: "000245", name: "Скамья №050-0002082-97", inventoryNumber: "050-0002082-97", externalId: null,
  warehouseExternalId: null, warehouseCode: "001", warehouseName: "Склад", barcode: null, unit: "шт", quantity: "1", unitPrice: "100", currency: "KZT",
  balanceSchemaVersion: 2, accountCode: "1311", responsibleCode: "001", responsibleName: "Первый Сотрудник" };
const metadata = () => ({ sourceSha256: createHash("sha256").update(randomUUID()).digest("hex"), requestId: randomUUID(), sourceFilename: "test.xml" });
const hiddenBalance: OneCMaterial = { ...material, name: "Другой остаток", inventoryNumber: "9999999",
  responsibleCode: "002", responsibleName: "Второй Сотрудник", unitPrice: "200" };

describe("reviewed 1C nomenclature code confirmation", () => {
  beforeAll(async () => {
    config = readDatabaseConfig({ purpose: "migration", target: "test" });
    await reset();
    await migrateDatabase(config);
    owner = createPostgresPool(config, { max: 2 });
    // Confirmation must work without requesting a nested connection.
    pool = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "test" }), { max: 1 });
  });
  beforeEach(async () => { await owner.query('truncate yu_inventory.users, yu_inventory.one_c_material_import_batches, yu_inventory.one_c_material_inbox cascade'); });
  afterAll(async () => { await pool?.end(); await owner?.end(); await reset(); });

  it("groups same-code balances, atomically saves reviewed code and records the reviewed sources", async () => {
    const f = await seed();
    const snapshot = await getOneCAnalyticsSnapshot(pool);
    expect(snapshot.rows[0].excel).toHaveLength(1);
    const cards = getOneCPossibleMatches(snapshot);
    expect(cards).toHaveLength(1);
    expect(cards[0].candidates).toHaveLength(1);
    expect(cards[0].candidates[0].balances).toHaveLength(2);
    await confirmOneCPossibleMatch(input(cards[0]), f.actor, pool);
    const item = (await pool.query("select one_c_code,unit_price,version from yu_inventory.items where id=$1", [f.itemId])).rows[0];
    expect(item).toMatchObject({ one_c_code: "000245", unit_price: "50.00", version: 2 });
    expect((await pool.query("select metadata from yu_inventory.audit_records where action='item.one_c_code_updated'")).rows[0].metadata).toMatchObject({ source: "one_c_possible_confirmation", selectedCode: "000245" });
    expect(getOneCPossibleMatches(await getOneCAnalyticsSnapshot(pool))).toHaveLength(0);
  });

  it("rejects a review after the card changes and preserves the new code", async () => {
    const f = await seed();
    const [card] = getOneCPossibleMatches(await getOneCAnalyticsSnapshot(pool));
    await pool.query("update yu_inventory.items set one_c_code='NEW',version=version+1 where id=$1", [f.itemId]);
    await expect(confirmOneCPossibleMatch(input(card), f.actor, pool)).rejects.toMatchObject({ publicCode: "one_c_possible_stale" });
    expect((await pool.query("select one_c_code from yu_inventory.items where id=$1", [f.itemId])).rows[0].one_c_code).toBe("NEW");
  });

  it("rejects a review after an imported price or owner changes", async () => {
    const f = await seed();
    const [card] = getOneCPossibleMatches(await getOneCAnalyticsSnapshot(pool));
    await save([material, { ...hiddenBalance, responsibleName: "Новый Сотрудник", unitPrice: "999" }], "2026-11-12T12:00:00Z");
    await expect(confirmOneCPossibleMatch(input(card), f.actor, pool)).rejects.toMatchObject({ publicCode: "one_c_possible_stale" });
    expect((await pool.query("select one_c_code from yu_inventory.items where id=$1", [f.itemId])).rows[0].one_c_code).toBeNull();
  });

  it("rolls back the code if the audit insert fails", async () => {
    const f = await seed();
    const [card] = getOneCPossibleMatches(await getOneCAnalyticsSnapshot(pool));
    await owner.query(`create function yu_inventory.reject_possible_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end $$;
      create trigger reject_possible_audit before insert on yu_inventory.audit_records for each row execute function yu_inventory.reject_possible_audit()`);
    try {
      await expect(confirmOneCPossibleMatch(input(card), f.actor, pool)).rejects.toThrow("audit unavailable");
      expect((await pool.query("select one_c_code,version from yu_inventory.items where id=$1", [f.itemId])).rows[0]).toMatchObject({ one_c_code: null, version: 1 });
    } finally { await owner.query("drop trigger reject_possible_audit on yu_inventory.audit_records; drop function yu_inventory.reject_possible_audit()"); }
  });

  it("rejects unsupported IT code updates and arbitrary unreviewed codes", async () => {
    const f = await seed();
    const [card] = getOneCPossibleMatches(await getOneCAnalyticsSnapshot(pool));
    await expect(confirmOneCPossibleMatch({ ...input(card), code: "UNREVIEWED" }, f.actor, pool)).rejects.toMatchObject({ publicCode: "one_c_possible_stale" });
    await pool.query("update yu_inventory.items set item_section='it' where id=$1", [f.itemId]);
    const [itCard] = getOneCPossibleMatches(await getOneCAnalyticsSnapshot(pool));
    expect(itCard.itemSection).toBe("it");
    await expect(confirmOneCPossibleMatch(input(itCard), f.actor, pool)).rejects.toMatchObject({ publicCode: "one_c_possible_unsupported_section" });
  });
});

function input(card: ReturnType<typeof getOneCPossibleMatches>[number]) {
  return { itemId: card.id, itemVersion: card.itemVersion, reviewHash: card.reviewHash, code: card.candidates[0].code };
}
async function save(materials: OneCMaterial[], snapshotAt = "2026-11-11T12:00:00Z") {
  await new PostgresOneCMaterialsRepository(pool).saveSnapshot({ materials, snapshotAt }, metadata());
}
async function seed() {
  const userId = randomUUID(), buildingId = randomUUID(), roomId = randomUUID(), itemId = randomUUID();
  await pool.query("insert into yu_inventory.users(id,code,email,full_name,role,created_at,updated_at) values($1,$2,$3,'Admin','admin',now(),now())", [userId, `possible-${userId.slice(0, 8)}`, `${userId}@example.test`]);
  await pool.query("insert into yu_inventory.buildings(id,name,name_key,address,address_key,created_by,updated_by) values($1::uuid,'Building',$1::text,'Address',$1::text,$2,$2)", [buildingId, userId]);
  await pool.query("insert into yu_inventory.rooms(id,building_id,designation,designation_key,floor_number,created_by,updated_by) values($1::uuid,$2,'101',$1::text,1,$3,$3)", [roomId, buildingId, userId]);
  await pool.query("insert into yu_inventory.items(id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by) values($1,'Скамья',1,50,$2,'official','050-0002082','0500002082',$3,$3)", [itemId, roomId, userId]);
  await save([material, hiddenBalance]);
  return { itemId, actor: { userId, role: "admin" as const, sessionVersion: 1 } };
}
async function reset() {
  if (!config.databaseName.endsWith("_test")) throw new Error("Refusing non-test reset");
  const db = createPostgresPool(config, { max: 1 });
  try { await db.query("drop schema if exists yu_migrations cascade; drop schema if exists yu_inventory cascade"); }
  finally { await db.end(); }
}
