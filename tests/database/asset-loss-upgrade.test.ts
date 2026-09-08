import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";

const TARGET = "20260908150000_asset_loss_event_contract";
const config = readDatabaseConfig({ purpose: "migration", target: "test" });
let database: Pool;
let predecessorFolder: string;

describe("asset-loss forward migration upgrade", () => {
  beforeEach(async () => {
    await database?.end();
    await resetSchemas(config);
    predecessorFolder = createPredecessorFolder();
    database = createPostgresPool(config, { max: 2 });
    await migrate(drizzle({ client: database }), { migrationsFolder: predecessorFolder, migrationsSchema: "yu_migrations", migrationsTable: "__drizzle_migrations" });
  });
  afterAll(async () => {
    await database?.end(); await closeDatabase(); await resetSchemas(config);
    if (predecessorFolder) rmSync(predecessorFolder, { recursive: true, force: true });
  });

  it("backfills the exact responsibility snapshot for an existing open case", async () => {
    const fixture = await seedLegacyCase({ withPeriod: true, discontinuous: false });
    await migrateDatabase(config);
    await expect(database.query<{ responsibility_period_id: string }>('select responsibility_period_id from "yu_inventory"."asset_loss_cases" where id = $1', [fixture.caseId])).resolves.toMatchObject({ rows: [{ responsibility_period_id: fixture.periodId }] });
  });

  it("aborts atomically when an open legacy case has no safe responsibility snapshot", async () => {
    await seedLegacyCase({ withPeriod: false, discontinuous: false });
    await expect(migrateDatabase(config)).rejects.toThrow(/cannot establish responsibility snapshot/);
    await expect(database.query<{ exists: boolean }>(`select exists(select 1 from information_schema.columns where table_schema='yu_inventory' and table_name='asset_loss_cases' and column_name='responsibility_period_id') as exists`)).resolves.toMatchObject({ rows: [{ exists: false }] });
  });

  it("aborts on a discontinuous legacy financial event chain", async () => {
    await seedLegacyCase({ withPeriod: true, discontinuous: true });
    await expect(migrateDatabase(config)).rejects.toThrow(/event history is discontinuous/);
  });
});

function createPredecessorFolder() {
  const folder = mkdtempSync(path.join(tmpdir(), "asset-loss-predecessor-"));
  mkdirSync(path.join(folder, "meta"));
  for (const name of readdirSync("drizzle").filter((name) => name.endsWith(".sql") && name !== `${TARGET}.sql`)) copyFileSync(path.join("drizzle", name), path.join(folder, name));
  const journal = JSON.parse(readFileSync(path.join("drizzle", "meta", "_journal.json"), "utf8")) as { version: string; dialect: string; entries: Array<{ tag: string }> };
  journal.entries = journal.entries.filter((entry) => entry.tag !== TARGET);
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  return folder;
}

async function seedLegacyCase(options: { withPeriod: boolean; discontinuous: boolean }) {
  const ids = { adminId: randomUUID(), employeeId: randomUUID(), buildingId: randomUUID(), roomId: randomUUID(), itemId: randomUUID(), periodId: randomUUID(), caseId: randomUUID() };
  await database.query(`insert into "yu_inventory"."users" (id,code,email,full_name,role,created_at,updated_at) values ($1,$3,$4,'Admin','admin',now(),now()),($2,$5,$6,'Employee','employee',now(),now())`, [ids.adminId, ids.employeeId, `UA-${ids.adminId.slice(0,8)}`, `${ids.adminId}@example.com`, `UE-${ids.employeeId.slice(0,8)}`, `${ids.employeeId}@example.com`]);
  await database.query(`insert into "yu_inventory"."buildings" (id,name,name_key,address,address_key,created_by,updated_by) values ($1,'Upgrade Building',$2,'Upgrade Address',$2,$3,$3)`, [ids.buildingId, `upgrade-${ids.buildingId}`, ids.adminId]);
  await database.query(`insert into "yu_inventory"."rooms" (id,building_id,designation,designation_key,floor_number,created_by,updated_by) values ($1,$2,'Upgrade Room',$3,1,$4,$4)`, [ids.roomId, ids.buildingId, `upgrade-${ids.roomId}`, ids.adminId]);
  await database.query(`insert into "yu_inventory"."items" (id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by) values ($1,'Upgrade Item',1,1,$2,'official',$3,$4,$5,$5)`, [ids.itemId, ids.roomId, `UP-${ids.itemId}`, `up-${ids.itemId}`, ids.adminId]);
  if (options.withPeriod) await database.query(`insert into "yu_inventory"."responsibility_periods" (id,item_id,responsible_user_id,source,started_at,started_by) values ($1,$2,$3,'transfer','2026-01-01T00:00:00Z',$4)`, [ids.periodId, ids.itemId, ids.employeeId, ids.adminId]);
  await database.query(`insert into "yu_inventory"."asset_loss_cases" (id,employee_id,item_id,status,amount,currency,created_at) values ($1,$2,$3,'payment_pending',1,'KZT','2026-02-01T00:00:00Z')`, [ids.caseId, ids.employeeId, ids.itemId]);
  await database.query(`insert into "yu_inventory"."asset_loss_case_events" (id,loss_case_id,from_status,to_status,actor_id,occurred_at) values ($1,$2,null,'payment_pending',$3,'2026-02-01T00:00:00Z')`, [randomUUID(), ids.caseId, ids.employeeId]);
  if (options.discontinuous) await database.query(`insert into "yu_inventory"."asset_loss_case_events" (id,loss_case_id,from_status,to_status,actor_id,occurred_at) values ($1,$2,null,'payment_pending',$3,'2026-02-02T00:00:00Z')`, [randomUUID(), ids.caseId, ids.employeeId]);
  return ids;
}

async function resetSchemas(databaseConfig: DatabaseConfig) {
  if (!databaseConfig.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(databaseConfig, { max: 1 });
  try { await pool.query('drop schema if exists "yu_migrations" cascade'); await pool.query('drop schema if exists "yu_inventory" cascade'); } finally { await pool.end(); }
}
