import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { AssetLossService } from "@/lib/application/services/asset-loss-service";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresAssetLossRepositories } from "@/lib/server/persistence/postgres/postgres-asset-loss-repository";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";

let migrationConfig: DatabaseConfig;
let migrationPool: Pool;
let runtimePool: Pool;

describe("PostgreSQL asset-loss vertical", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({ purpose: "migration", target: "test" });
    const runtimeConfig = readDatabaseConfig({ purpose: "runtime", target: "test" });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    migrationPool = createPostgresPool(migrationConfig, { max: 4 });
    runtimePool = createPostgresPool(runtimeConfig, { max: 4 });
  });
  beforeEach(async () => { await migrationPool.query('truncate table "yu_inventory"."asset_loss_case_events", "yu_inventory"."asset_loss_cases", "yu_inventory"."photos", "yu_inventory"."responsibility_periods", "yu_inventory"."items", "yu_inventory"."rooms", "yu_inventory"."buildings", "yu_inventory"."users" cascade'); });
  afterAll(async () => { await runtimePool?.end(); await migrationPool?.end(); await closeDatabase(); await resetSchemas(migrationConfig); });

  it("serializes concurrent create and keeps a single open case", async () => {
    const fixture = await seed();
    const first = service(); const second = service();
    const results = await Promise.allSettled([
      first.create({ itemId: fixture.itemId }, employee(fixture.employeeId)),
      second.create({ itemId: fixture.itemId }, employee(fixture.employeeId)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(migrationPool.query<{ count: number }>('select count(*)::int as count from "yu_inventory"."asset_loss_cases"')).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("supersedes a rejected receipt in the same state transition", async () => {
    const fixture = await seed(); const app = service();
    const created = await app.create({ itemId: fixture.itemId }, employee(fixture.employeeId));
    await app.submitReceipt(created.id, photo([1]), employee(fixture.employeeId));
    await app.review(created.id, { decision: "rejected", comment: "Wrong receipt" }, admin(fixture.adminId));
    await app.submitReceipt(created.id, photo([2]), employee(fixture.employeeId));
    const photos = await migrationPool.query<{ status: string; value: number }>(
      `select status, get_byte(binary_data, 0) as value from "yu_inventory"."photos" where purpose = 'asset_loss_receipt' order by reserved_at, id`,
    );
    expect(photos.rows.map((row) => row.status).sort()).toEqual(["attached", "superseded"]);
    expect(photos.rows.find((row) => row.status === "attached")?.value).toBe(2);
  });

  it("approval rejects same-employee ABA responsibility and leaves the replacement period open", async () => {
    const fixture = await seed(); const app = service();
    const created = await app.create({ itemId: fixture.itemId }, employee(fixture.employeeId));
    await app.submitReceipt(created.id, photo([1]), employee(fixture.employeeId));
    await migrationPool.query('update "yu_inventory"."responsibility_periods" set ended_at = now(), ended_by = $2, end_reason = \'Transferred\' where id = $1', [fixture.periodId, fixture.adminId]);
    const replacementPeriodId = randomUUID();
    await migrationPool.query(`insert into "yu_inventory"."responsibility_periods" (id,item_id,responsible_user_id,source,started_at,started_by) values ($1,$2,$3,'transfer',now(),$4)`, [replacementPeriodId, fixture.itemId, fixture.employeeId, fixture.adminId]);
    await expect(app.review(created.id, { decision: "approved" }, admin(fixture.adminId))).rejects.toMatchObject({ publicCode: "loss_responsibility_changed" });
    await expect(migrationPool.query<{ status: string }>('select status from "yu_inventory"."asset_loss_cases" where id = $1', [created.id])).resolves.toMatchObject({ rows: [{ status: "accounting_review" }] });
    await expect(migrationPool.query<{ ended_at: Date | null }>('select ended_at from "yu_inventory"."responsibility_periods" where id = $1', [replacementPeriodId])).resolves.toMatchObject({ rows: [{ ended_at: null }] });
  });

  it("rolls responsibility closure back if the guarded case update fails", async () => {
    const fixture = await seed(); const app = service();
    const created = await app.create({ itemId: fixture.itemId }, employee(fixture.employeeId));
    await app.submitReceipt(created.id, photo([1]), employee(fixture.employeeId));
    await migrationPool.query(`create function "yu_inventory"."reject_loss_close"() returns trigger language plpgsql as $$ begin if new.status = 'closed' then raise exception 'test failure'; end if; return new; end $$`);
    await migrationPool.query(`create trigger "reject_loss_close" before update on "yu_inventory"."asset_loss_cases" for each row execute function "yu_inventory"."reject_loss_close"()`);
    try {
      await expect(app.review(created.id, { decision: "approved" }, admin(fixture.adminId))).rejects.toThrow();
      await expect(migrationPool.query<{ ended_at: Date | null }>('select ended_at from "yu_inventory"."responsibility_periods" where id = $1', [fixture.periodId])).resolves.toMatchObject({ rows: [{ ended_at: null }] });
      await expect(migrationPool.query<{ status: string }>('select status from "yu_inventory"."asset_loss_cases" where id = $1', [created.id])).resolves.toMatchObject({ rows: [{ status: "accounting_review" }] });
    } finally {
      await migrationPool.query('drop trigger if exists "reject_loss_close" on "yu_inventory"."asset_loss_cases"');
      await migrationPool.query('drop function if exists "yu_inventory"."reject_loss_close"()');
    }
  });

  it("keeps the financial event log append-only and rejects discontinuous edges", async () => {
    const fixture = await seed();
    const created = await service().create({ itemId: fixture.itemId }, employee(fixture.employeeId));
    const event = await migrationPool.query<{ id: string }>('select id from "yu_inventory"."asset_loss_case_events" where loss_case_id = $1', [created.id]);
    await expect(migrationPool.query('update "yu_inventory"."asset_loss_case_events" set comment = \'changed\' where id = $1', [event.rows[0]!.id])).rejects.toMatchObject({ code: "55000" });
    await expect(migrationPool.query(`insert into "yu_inventory"."asset_loss_case_events" (id,loss_case_id,from_status,to_status,actor_id) values ($1,$2,'rejected','accounting_review',$3)`, [randomUUID(), created.id, fixture.employeeId])).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a case status change that omits its matching event", async () => {
    const fixture = await seed();
    const app = service();
    const created = await app.create({ itemId: fixture.itemId }, employee(fixture.employeeId));
    await app.submitReceipt(created.id, photo([1]), employee(fixture.employeeId));

    await expect(migrationPool.query(
      `update "yu_inventory"."asset_loss_cases"
          set status = 'rejected', reviewed_by = $2, reviewed_at = now(),
              review_result = 'rejected', review_comment = 'Direct mutation'
        where id = $1`,
      [created.id, fixture.adminId],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(migrationPool.query<{ status: string }>(
      'select status from "yu_inventory"."asset_loss_cases" where id = $1',
      [created.id],
    )).resolves.toMatchObject({ rows: [{ status: "accounting_review" }] });
  });

  it("allows multiple fully-evented transitions in one transaction", async () => {
    const fixture = await seed();
    const app = service();
    const created = await app.create({ itemId: fixture.itemId }, employee(fixture.employeeId));
    await app.submitReceipt(created.id, photo([1]), employee(fixture.employeeId));
    const client = await migrationPool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update "yu_inventory"."asset_loss_cases"
            set status = 'rejected', reviewed_by = $2, reviewed_at = now(),
                review_result = 'rejected', review_comment = 'First review'
          where id = $1`,
        [created.id, fixture.adminId],
      );
      await client.query(
        `insert into "yu_inventory"."asset_loss_case_events"
          (id,loss_case_id,from_status,to_status,actor_id,occurred_at)
         values ($1,$2,'accounting_review','rejected',$3,clock_timestamp())`,
        [randomUUID(), created.id, fixture.adminId],
      );
      await client.query(
        `update "yu_inventory"."asset_loss_cases"
            set status = 'accounting_review', reviewed_by = null, reviewed_at = null,
                review_result = null, review_comment = null
          where id = $1`,
        [created.id],
      );
      await client.query(
        `insert into "yu_inventory"."asset_loss_case_events"
          (id,loss_case_id,from_status,to_status,actor_id,occurred_at)
         values ($1,$2,'rejected','accounting_review',$3,clock_timestamp() + interval '1 millisecond')`,
        [randomUUID(), created.id, fixture.adminId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    await expect(migrationPool.query<{ status: string }>(
      'select status from "yu_inventory"."asset_loss_cases" where id = $1',
      [created.id],
    )).resolves.toMatchObject({ rows: [{ status: "accounting_review" }] });
  });

  it("serializes concurrent accounting decisions to one terminal edge", async () => {
    const fixture = await seed(); const app = service();
    const created = await app.create({ itemId: fixture.itemId }, employee(fixture.employeeId));
    await app.submitReceipt(created.id, photo([1]), employee(fixture.employeeId));
    const outcomes = await Promise.allSettled([
      service().review(created.id, { decision: "approved" }, admin(fixture.adminId)),
      service().review(created.id, { decision: "rejected", comment: "No" }, admin(fixture.adminId)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await expect(migrationPool.query<{ count: number }>('select count(*)::int as count from "yu_inventory"."asset_loss_case_events" where loss_case_id = $1', [created.id])).resolves.toMatchObject({ rows: [{ count: 3 }] });
  });
});

function service() {
  return new AssetLossService(new PostgresUnitOfWork(() => runtimePool, createPostgresAssetLossRepositories), { now: () => new Date(), id: () => randomUUID(), checksum: (bytes) => createHash("sha256").update(bytes).digest("hex") });
}
function employee(userId: string) { return { userId, role: "employee" as const, sessionVersion: 1 }; }
function admin(userId: string) { return { userId, role: "admin" as const, sessionVersion: 1 }; }
function photo(values: number[]) { return { bytes: new Uint8Array(values), width: 1, height: 1, mediaType: "image/jpeg" as const }; }

async function seed() {
  const ids = { adminId: randomUUID(), employeeId: randomUUID(), buildingId: randomUUID(), roomId: randomUUID(), itemId: randomUUID(), periodId: randomUUID() };
  await migrationPool.query(`insert into "yu_inventory"."users" (id, code, email, full_name, role, created_at, updated_at) values ($1,$3,$4,'Loss Admin','admin',now(),now()),($2,$5,$6,'Loss Employee','employee',now(),now())`, [ids.adminId, ids.employeeId, `LA-${ids.adminId.slice(0,8)}`, `${ids.adminId}@example.com`, `LE-${ids.employeeId.slice(0,8)}`, `${ids.employeeId}@example.com`]);
  await migrationPool.query(`insert into "yu_inventory"."buildings" (id,name,name_key,address,address_key,created_by,updated_by) values ($1,'Loss Building',$2,'Loss Address',$2,$3,$3)`, [ids.buildingId, `loss-${ids.buildingId}`, ids.adminId]);
  await migrationPool.query(`insert into "yu_inventory"."rooms" (id,building_id,designation,designation_key,floor_number,created_by,updated_by) values ($1,$2,'Loss Room',$3,1,$4,$4)`, [ids.roomId, ids.buildingId, `loss-${ids.roomId}`, ids.adminId]);
  await migrationPool.query(`insert into "yu_inventory"."items" (id,name,quantity,unit_price,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by) values ($1,'Loss Item',1,100,$2,'official',$3,$4,$5,$5)`, [ids.itemId, ids.roomId, `LOSS-${ids.itemId}`, `loss-${ids.itemId}`, ids.adminId]);
  await migrationPool.query(`insert into "yu_inventory"."responsibility_periods" (id,item_id,responsible_user_id,source,started_at,started_by) values ($1,$2,$3,'transfer',now(),$3)`, [ids.periodId, ids.itemId, ids.employeeId]);
  return ids;
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(config, { max: 1 });
  try { await pool.query('drop schema if exists "yu_migrations" cascade'); await pool.query('drop schema if exists "yu_inventory" cascade'); } finally { await pool.end(); }
}
