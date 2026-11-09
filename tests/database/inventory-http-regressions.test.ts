import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as listItems, POST as createItem } from "@/app/api/inventory/items/route";
import { GET as resolveQr } from "@/app/api/inventory/qr/resolve/route";
import { GET as dormitoryItems } from "@/app/api/v1/dormitory/items/route";
import { DORMITORY_NAMES } from "@/lib/server/persistence/postgres/postgres-dormitory-asset-repository";
import { GET as readItem } from "@/app/api/inventory/items/[id]/route";
import { PATCH as changeCode } from "@/app/api/inventory/items/bulk-one-c-code/route";
import { PATCH as changeProject } from "@/app/api/inventory/items/bulk-project/route";
import { GET as recipients } from "@/app/api/inventory/transfer-recipient-candidates/route";
import { GET as readSettings, PATCH as saveSettings } from "@/app/api/settings/route";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { COLLECTION_LIMITS } from "@/lib/server/persistence/collection-limits";
import { authenticatedRequest } from "./support/http-request";
import { database, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

// Background external delivery belongs to the running Next server lifecycle.
// Authentication, services, PostgreSQL and all mutations below are real.
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: () => undefined }));

async function fixture(count = 2) {
  const f = await seedFixture(count);
  await database.query("update yu_inventory.users set role='admin' where id=$1", [f.recipientIds[0]]);
  const room = (await database.query("select id,building_id from yu_inventory.rooms where created_by=$1", [f.initiatorId])).rows[0];
  return { ...f, roomId: room.id as string, admin: { userId: f.recipientIds[0]!, role: "admin" as const }, employee: { userId: f.initiatorId, role: "employee" as const } };
}
async function snapshot(ids: string[]) {
  return (await database.query("select id,name,one_c_code,is_project,version,room_id,status,inventory_number,quantity from yu_inventory.items where id=any($1::uuid[]) order by id", [ids])).rows;
}
async function audit(ids: string[]) {
  return (await database.query("select subject_id,action,before_values,after_values from yu_inventory.audit_records where subject_id=any($1::uuid[]) order by subject_id,occurred_at", [ids])).rows;
}
const base = "/api/inventory/items";

describe("inventory endpoints preserve persisted behavior", () => {
  beforeAll(async () => { resetApplicationServicesForTests(); await setupTmcTransferDatabase(); });
  afterAll(async () => { resetApplicationServicesForTests(); await teardownTmcTransferDatabase(); });

  it("persists a bulk code with leading zeroes, reloads it and leaves an unselected item unchanged", async () => {
    const f = await fixture(3);
    const selected = f.itemIds.slice(0, 2);
    const before = await snapshot(f.itemIds);
    const response = await changeCode(authenticatedRequest(`${base}/bulk-one-c-code`, f.admin, { method: "PATCH", body: { itemIds: selected, oneCCode: " 00000014398 " } }));
    expect(response.status, await response.clone().text()).toBe(200);
    for (const id of selected) {
      const reloaded = await readItem(authenticatedRequest(`${base}/${id}`, f.admin), { params: Promise.resolve({ id }) });
      expect(reloaded.status).toBe(200);
      expect((await reloaded.json()).item.oneCCode).toBe("00000014398");
    }
    expect(await snapshot(f.itemIds)).toEqual(before.map(row => selected.includes(row.id) ? { ...row, one_c_code: "00000014398", version: row.version + 1 } : row));
    const effects = await audit(selected);
    expect(effects).toHaveLength(2);
    expect(effects.every(row => row.action === "item.one_c_code_updated" && row.before_values.oneCCode === null && row.after_values.oneCCode === "00000014398")).toBe(true);
    const committed = await snapshot(f.itemIds);
    expect((await changeCode(authenticatedRequest(`${base}/bulk-one-c-code`, f.admin, { method: "PATCH", body: { itemIds: selected, oneCCode: "00000014398" } }))).status).toBe(200);
    expect(await snapshot(f.itemIds)).toEqual(committed);
    expect(await audit(selected)).toEqual(effects);
  });

  it.each(["code", "project"] as const)("rolls back a %s batch and audit when the second persisted update fails", async (kind) => {
    const f = await fixture();
    const before = await snapshot(f.itemIds);
    // Fail after an earlier UPDATE and its audit have already run in PostgreSQL.
    // This is a real database exception, not a fake implementing its own rollback.
    await database.query(`create function yu_inventory.review_fail_second_update() returns trigger language plpgsql as $$
      begin if new.id = '${f.itemIds[1]}'::uuid then raise exception 'review injected late write failure'; end if; return new; end $$`);
    await database.query("create trigger review_fail_second_update before update on yu_inventory.items for each row execute function yu_inventory.review_fail_second_update()");
    try {
      const response = kind === "code"
        ? await changeCode(authenticatedRequest(`${base}/bulk-one-c-code`, f.admin, { method: "PATCH", body: { itemIds: f.itemIds, oneCCode: "00042" } }))
        : await changeProject(authenticatedRequest(`${base}/bulk-project`, f.admin, { method: "PATCH", body: { itemIds: f.itemIds, isProject: true } }));
      expect(response.status).toBe(kind === "code" ? 500 : 503);
      expect(await snapshot(f.itemIds)).toEqual(before);
      expect(await audit(f.itemIds)).toEqual([]);
    } finally {
      await database.query("drop trigger review_fail_second_update on yu_inventory.items");
      await database.query("drop function yu_inventory.review_fail_second_update()");
    }
  });

  it("rejects a forged or revoked administrator cookie without changing the bulk selection", async () => {
    const f = await fixture();
    const before = await snapshot(f.itemIds);
    const forged = await changeCode(authenticatedRequest(`${base}/bulk-one-c-code`, { ...f.employee, role: "admin" }, { method: "PATCH", body: { itemIds: f.itemIds, oneCCode: "00042" } }));
    expect(forged.status).toBe(403);
    await database.query("update yu_inventory.users set version=version+1 where id=$1", [f.admin.userId]);
    const revoked = await changeProject(authenticatedRequest(`${base}/bulk-project`, f.admin, { method: "PATCH", body: { itemIds: f.itemIds, isProject: true } }));
    expect(revoked.status).toBe(401);
    expect(await snapshot(f.itemIds)).toEqual(before);
    expect(await audit(f.itemIds)).toEqual([]);
  });

  it("rejects a cross-origin bulk mutation even with a valid administrator cookie", async () => {
    const f = await fixture();
    const before = await snapshot(f.itemIds);
    const request = authenticatedRequest(`${base}/bulk-project`, f.admin, { method: "PATCH", body: { itemIds: f.itemIds, isProject: true } });
    request.headers.set("origin", "https://foreign.invalid");
    expect((await changeProject(request)).status).toBe(403);
    expect(await snapshot(f.itemIds)).toEqual(before);
    expect(await audit(f.itemIds)).toEqual([]);
  });

  it("scopes the employee collection before returning data and hides codes independently of ownership", async () => {
    const f = await fixture();
    const other = await fixture(1);
    await database.query("update yu_inventory.items set one_c_code='00042' where id=any($1::uuid[])", [f.itemIds]);
    const response = await listItems(authenticatedRequest(base, f.employee));
    expect(response.status).toBe(200);
    const { items } = await response.json();
    expect(items.map((item: { id: string }) => item.id).sort()).toEqual([...f.itemIds].sort());
    expect(JSON.stringify(items)).not.toContain("00042");
    expect(items.every((item: { responsible: { id: string } }) => item.responsible.id === f.employee.userId)).toBe(true);
    expect(items.some((item: { id: string }) => item.id === other.itemIds[0])).toBe(false);
  });

  it("searches actual active recipients, excludes self and returns only the public directory fields", async () => {
    const f = await fixture(0);
    const prefix = `Review ${randomUUID()}`;
    const records = [f.initiatorId, ...f.recipientIds];
    await database.query("update yu_inventory.users set full_name=$2 where id=any($1::uuid[])", [records, prefix]);
    await database.query("update yu_inventory.users set is_active=false,deactivated_at=now() where id=$1", [f.recipientIds[1]]);
    const response = await recipients(authenticatedRequest(`/api/inventory/transfer-recipient-candidates?q=${encodeURIComponent(prefix)}`, f.employee));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.users.map((user: { id: string }) => user.id)).toEqual([f.admin.userId]);
    expect(Object.keys(payload.users[0]).sort()).toEqual(["email", "fullName", "id", "role"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("hides a guessed IT identifier from the general item endpoint even for an administrator", async () => {
    const f = await fixture(1);
    await database.query("update yu_inventory.items set item_section='it',it_type='camera',item_type='camera' where id=$1", [f.itemIds[0]]);
    const response = await readItem(authenticatedRequest(`${base}/${f.itemIds[0]}`, f.admin), { params: Promise.resolve({ id: f.itemIds[0]! }) });
    expect(response.status, await response.clone().text()).toBe(404);
    expect(await response.json()).toEqual({ error: "item_not_found" });
  });

  it("creates a component with a blank or supplied number and preserves its chosen lifecycle on reload", async () => {
    const f = await fixture(0);
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer();
    const photo = { imageDataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`, width: 2, height: 2 };
    for (const [status, barcode] of [["broken", ""], ["maintenance", "COMP-123"]] as const) {
      const response = await createItem(authenticatedRequest(base, f.admin, { body: { name: "HTTP component", category: "components", roomId: f.roomId, status, barcode: barcode || null, photo } }));
      expect(response.status, await response.clone().text()).toBe(201);
      const { item } = await response.json();
      const reloaded = await readItem(authenticatedRequest(`${base}/${item.id}`, f.admin), { params: Promise.resolve({ id: item.id }) });
      expect((await reloaded.json()).item).toMatchObject({ status, inventoryNumber: barcode });
    }
    const before = await database.query("select count(*)::int as n from yu_inventory.items");
    expect((await createItem(authenticatedRequest(base, f.admin, { body: { name: "No evidence", category: "components", roomId: f.roomId } }))).status).toBe(400);
    expect((await createItem(authenticatedRequest(base, f.admin, { body: { name: "Excessive evidence", category: "components", roomId: f.roomId, photos: Array.from({ length: 11 }, () => photo) } }))).status).toBe(400);
    expect((await database.query("select count(*)::int as n from yu_inventory.items")).rows).toEqual(before.rows);
  });

  it("resolves a local barcode without turning a written-off parent into an active item", async () => {
    const f = await fixture(1);
    const barcode = `LOCAL-${randomUUID()}`;
    await database.query(`insert into yu_inventory.local_item_groups
      (id,item_id,sequence_number,barcode_value,barcode_key,quantity,responsible_user_id,room_id,previous_responsible_user_id,previous_room_id,created_by)
      values($1,$2,nextval('yu_inventory.local_barcode_sequence'),$3::text,lower($3::text),1,$4,$5,$4,$5,$4)`, [randomUUID(), f.itemIds[0], barcode, f.initiatorId, f.roomId]);
    await database.query("update yu_inventory.items set status='decommissioned' where id=$1", [f.itemIds[0]]);
    const response = await resolveQr(authenticatedRequest(`/api/inventory/qr/resolve?kind=barcode&value=${barcode}`, f.admin));
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).resolution.target).toMatchObject({ id: f.itemIds[0], status: "decommissioned", inventoryNumber: barcode });
  });

  it("persists settings through the endpoint and rejects an invalid patch without overwriting them", async () => {
    const f = await fixture(0);
    expect((await saveSettings(authenticatedRequest("/api/settings", f.admin, { method: "PATCH", body: { organizationName: "HTTP settings" } }))).status).toBe(200);
    const read = () => readSettings(authenticatedRequest("/api/settings", f.admin));
    const saved = await (await read()).json();
    expect(saved.organizationName).toBe("HTTP settings");
    expect((await saveSettings(authenticatedRequest("/api/settings", f.admin, { method: "PATCH", body: { language: "xx" } }))).status).toBe(400);
    expect(await (await read()).json()).toEqual(saved);
  });

  it("exports only maintained dormitory buildings and maps both write-off states to the external status", async () => {
    const ordinary = await fixture(1);
    const dormitory = await fixture(2);
    await database.query("update yu_inventory.buildings set name=$1 where id=(select building_id from yu_inventory.rooms where id=$2)", [DORMITORY_NAMES[0], dormitory.roomId]);
    await database.query("update yu_inventory.items set status='decommissioned' where id=$1", [dormitory.itemIds[0]]);
    await database.query("update yu_inventory.items set status='decommissioned_in_use',archived_at=now(),archived_by=$2,decommissioned_usage_started_at=now(),decommissioned_usage_started_by=$2 where id=$1", [dormitory.itemIds[1], dormitory.admin.userId]);
    vi.stubEnv("DORMITORY_API_KEY", "review-dormitory-key");
    try {
      const response = await dormitoryItems(new Request("https://inventory.test/api/v1/dormitory/items", { headers: { authorization: "Bearer review-dormitory-key" } }));
      expect(response.status, await response.clone().text()).toBe(200);
      const { items } = await response.json();
      expect(items.map((item: { id: string }) => item.id).sort()).toEqual([...dormitory.itemIds].sort());
      expect(items.every((item: { status: string }) => item.status === "written_off")).toBe(true);
      expect(items.some((item: { id: string }) => item.id === ordinary.itemIds[0])).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it("commits outer writes after a handled nested failure and rolls back everything after an unhandled failure", async () => {
    await database.query("create table yu_inventory.review_transaction_probe(id text primary key)");
    const uow = new PostgresUnitOfWork(() => database, source => ({ insert: (id: string) => source.query("insert into yu_inventory.review_transaction_probe values($1)", [id]) }));
    await uow.transaction(async repo => {
      await repo.insert("outer-before");
      await expect(uow.transaction(async nested => { await nested.insert("inner"); await nested.insert("outer-before"); })).rejects.toThrow();
      await repo.insert("outer-after");
    });
    expect((await database.query("select id from yu_inventory.review_transaction_probe order by id")).rows).toEqual([{ id: "outer-after" }, { id: "outer-before" }]);
    await expect(uow.transaction(async repo => { await repo.insert("uncommitted-outer"); await uow.transaction(async nested => { await nested.insert("uncommitted-inner"); await nested.insert("outer-before"); }); })).rejects.toThrow();
    expect((await database.query("select id from yu_inventory.review_transaction_probe order by id")).rows).toEqual([{ id: "outer-after" }, { id: "outer-before" }]);
  });

  it("returns a complete large collection without duplicates and explicitly rejects an over-budget response", async () => {
    const f = await fixture(0);
    const before = Number((await database.query("select count(*)::int n from yu_inventory.items where item_section='general'")).rows[0].n);
    const prefix = randomUUID();
    // Commit bounded seed batches so per-number advisory locks do not exhaust
    // the disposable server's lock table before the collection is exercised.
    const remaining = COLLECTION_LIMITS.inventoryItems - before;
    for (let start = 1; start <= remaining; start += 250) {
      await database.query(`insert into yu_inventory.items(id,name,room_id,inventory_number_kind,inventory_number,inventory_number_key,created_by,updated_by,updated_at)
      select md5($1 || g)::uuid, 'Collection probe ' || g, $2, 'official', $1 || g, $1 || g, $3, $3,
        '2026-11-09T00:00:00.123456Z'::timestamptz from generate_series($4::integer,$5::integer) g`,
      [prefix, f.roomId, f.admin.userId, start, Math.min(start + 249, remaining)]);
    }
    const response = await listItems(authenticatedRequest(base, f.admin));
    expect(response.status, await response.clone().text()).toBe(200);
    const { items } = await response.json();
    expect(items).toHaveLength(COLLECTION_LIMITS.inventoryItems);
    expect(new Set(items.map((item: { id: string }) => item.id)).size).toBe(COLLECTION_LIMITS.inventoryItems);
    await seedFixture(1);
    const oversized = await listItems(authenticatedRequest(base, f.admin));
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).error).toBe("inventory_collection_requires_async_export");
  }, 15_000);
});
