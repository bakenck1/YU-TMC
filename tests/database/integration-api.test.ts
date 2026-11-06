import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { closeDatabase } from "@/lib/db/client";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { migrateDatabase } from "@/lib/db/migrations";
import { createPostgresPool } from "@/lib/db/pool";
import { createPostgresIntegrationRepository } from "@/lib/server/persistence/postgres/postgres-integration-repository";
import { INTEGRATION_ENTITIES } from "@/lib/contracts/integration-api";
import { integrationProjections } from "@/lib/server/integration-projections";
import { integrationGuard } from "@/lib/server/integration-auth";
import { createIntegrationKey } from "../../scripts/create-integration-key.mjs";

let config: DatabaseConfig;
let admin: Pool;
let runtime: Pool;
const userId = randomUUID();
const employeeId = randomUUID();
const buildingId = randomUUID();
const roomId = randomUUID();
const itemId = randomUUID();
const repository = () => createPostgresIntegrationRepository(runtime);

describe("integration API on PostgreSQL", () => {
  beforeAll(async () => {
    config = readDatabaseConfig({ purpose: "migration", target: "test" });
    await reset();
    await migrateDatabase(config);
    admin = createPostgresPool(config, { max: 4 });
    runtime = createPostgresPool(readDatabaseConfig({ purpose: "runtime", target: "test" }), { max: 4 });
    await admin.query(`insert into yu_inventory.users (id, code, email, full_name, role, iin, phone, created_at, updated_at)
      values ($1,'integration-admin','private-admin@example.com','Integration Admin','admin','900101400000','+77001112233',now(),now()),
             ($2,'integration-employee','private-employee@example.com','Integration Employee','employee',null,null,now(),now())`, [userId, employeeId]);
    await admin.query(`insert into yu_inventory.buildings (id,name,name_key,address,address_key,created_by,updated_by)
      values ($1,'Integration Building','integration building','Campus','campus',$2,$2)`, [buildingId, userId]);
    await admin.query(`insert into yu_inventory.rooms (id,building_id,designation,designation_key,floor_number,created_by,updated_by)
      values ($1,$2,'101','101',1,$3,$3)`, [roomId, buildingId, userId]);
    await insertItem(itemId, "Initial Item");
  }, 60_000);
  afterAll(async () => { await runtime?.end(); await admin?.end(); await closeDatabase(); await reset(); });

  it("all snapshots use explicit matching allowlists and never expose employee contacts or internal data", async () => {
    for (const entity of INTEGRATION_ENTITIES) {
      const rows = await repository().list(entity, null, 100);
      for (const row of rows) expect(Object.keys(row).sort()).toEqual([...integrationProjections[entity].fields].sort());
    }
    const people = JSON.stringify(await repository().list("employees", null, 100));
    expect(people).not.toMatch(/private-admin|900101400000|77001112233|email|tutor|password/);
    expect((await repository().list("items", null, 100))[0]!.unitPrice).toBe("100.00");
    const feed = await repository().changes("0:0", 100);
    expect(JSON.stringify(feed)).not.toMatch(/private-admin|900101400000|77001112233/);
  });
  it("paginates change batches and checkpoints without dropping rows", async () => {
    const ids: string[] = [];
    let cursor = "0:0";
    for (let i = 0; i < 20; i++) {
      const page = await repository().changes(cursor, 1);
      ids.push(...page.changes.map((entry) => entry.cursor));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect((await repository().changes(cursor, 100)).changes).toEqual([]);
  });
  it("holds back newer commits until every older writer completes, even when sequence allocation is reversed", async () => {
    const after = await repository().checkpoint();
    const old = await admin.connect();
    const newerId = randomUUID();
    const olderId = randomUUID();
    try {
      await old.query("begin");
      await old.query("select pg_current_xact_id()");
      await insertItem(newerId, "Newer Commit");
      expect((await repository().changes(after, 100)).changes).toEqual([]);
      await insertItem(olderId, "Older Transaction", old);
      await old.query("commit");
      const feed = await repository().changes(after, 100);
      expect(feed.changes.map((event) => event.recordId)).toEqual([olderId, newerId]);
      expect((await repository().changes(feed.nextCursor, 100)).changes).toEqual([]);
    } finally { await old.query("rollback"); old.release(); }
  });
  it("rolls events back with their operation and emits deletion tombstones", async () => {
    const after = await repository().checkpoint();
    const client = await admin.connect();
    const rolledBack = randomUUID();
    try { await client.query("begin"); await insertItem(rolledBack, "Rolled Back", client); await client.query("rollback"); }
    finally { client.release(); }
    expect((await repository().changes(after, 100)).changes).toEqual([]);
    const removed = randomUUID();
    await insertItem(removed, "Removed");
    await runtime.query("delete from yu_inventory.items where id=$1", [removed]);
    expect((await repository().changes(after, 100)).changes).toContainEqual(expect.objectContaining({ operation: "delete", recordId: removed, data: null }));
  });
  it("never sends an obsolete record state when an older XID writes after a newer XID", async () => {
    const after = await repository().checkpoint();
    const old = await admin.connect();
    const middle = await admin.connect();
    try {
      await old.query("begin"); await old.query("select pg_current_xact_id()");
      await middle.query("begin"); await middle.query("select pg_current_xact_id()");
      await admin.query("update yu_inventory.items set name='Intermediate' where id=$1", [itemId]);
      await old.query("update yu_inventory.items set name='Final' where id=$1", [itemId]);
      await old.query("commit");
      const first = await repository().changes(after, 100);
      expect(first.changes.filter((entry) => entry.recordId === itemId).map((entry) => entry.data?.name)).toEqual(["Final"]);
      await middle.query("commit");
      const second = await repository().changes(first.nextCursor, 100);
      expect(second.changes.filter((entry) => entry.recordId === itemId).map((entry) => entry.data?.name)).toEqual(["Final"]);
      expect(second.changes[0]!.revision).toBe(first.changes[0]!.revision);
    } finally { await old.query("rollback"); await middle.query("rollback"); old.release(); middle.release(); }
  });
  it("prevents the runtime role from tampering with the event journal while allowing trigger writes", async () => {
    await expect(runtime.query("update yu_inventory.integration_events set entity='employees'")).rejects.toMatchObject({ code: "42501" });
    await expect(runtime.query("delete from yu_inventory.integration_events")).rejects.toMatchObject({ code: "42501" });
    await expect(runtime.query("insert into yu_inventory.integration_events(entity,operation,record_id) values('items','delete',$1)", [randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await runtime.query("update yu_inventory.items set name='Runtime Update' where id=$1", [itemId]);
  });
  it("publishes responsibility changes and transfers made inside Inventory", async () => {
    const after = await repository().checkpoint();
    const periodId = randomUUID();
    const transferId = randomUUID();
    await runtime.query(`insert into yu_inventory.responsibility_periods
      (id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'accepted',$3)`, [periodId, itemId, userId]);
    await runtime.query(`insert into yu_inventory.transfers
      (id,item_id,requested_by,proposed_responsible_id,current_responsible_id_at_request)
      values($1,$2,$3,$3,$4)`, [transferId, itemId, employeeId, userId]);
    const feed = await repository().changes(after, 100);
    expect(feed.changes).toContainEqual(expect.objectContaining({ entity: "responsibilities", recordId: periodId,
      data: expect.objectContaining({ responsibleUserId: userId, itemId }) }));
    expect(feed.changes).toContainEqual(expect.objectContaining({ entity: "transfers", recordId: transferId,
      data: expect.objectContaining({ proposedResponsibleId: employeeId, currentResponsibleIdAtRequest: userId }) }));
  });
  it("enforces a durable per-key stream quota across IP addresses and returns retry headers", async () => {
    const key = createIntegrationKey("read");
    process.env.INTEGRATION_API_READ_KEY_SHA256 = key.hash;
    process.env.INTEGRATION_API_READ_EXPIRES_AT = key.expiresAt;
    try {
      for (let i = 0; i < 6; i++) expect(await integrationGuard(new Request("http://localhost/events", { headers: { authorization: `Bearer ${key.token}`, "x-real-ip": `10.0.0.${i + 1}` } }), true)).toBeNull();
      const blocked = await integrationGuard(new Request("http://localhost/events", { headers: { authorization: `Bearer ${key.token}`, "x-real-ip": "10.0.1.1" } }), true);
      expect(blocked?.status).toBe(429);
      expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThan(0);
    } finally {
      delete process.env.INTEGRATION_API_READ_KEY_SHA256;
      delete process.env.INTEGRATION_API_READ_EXPIRES_AT;
    }
  });
});

async function insertItem(id: string, name: string, source: Pick<Pool, "query"> = admin) {
  await source.query(`insert into yu_inventory.items (id,name,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by,unit_price)
    values($1,$2,$3,'official',$4::text,$4::text,$5,$5,100)`, [id, name, roomId, `API-${id}`, userId]);
}
async function reset() {
  if (!config?.databaseName.toLowerCase().endsWith("_test")) throw new Error("Refusing to reset a database without the _test suffix.");
  const pool = createPostgresPool(config, { max: 1 });
  try { await pool.query('drop schema if exists "yu_migrations" cascade'); await pool.query('drop schema if exists "yu_inventory" cascade'); }
  finally { await pool.end(); }
}
