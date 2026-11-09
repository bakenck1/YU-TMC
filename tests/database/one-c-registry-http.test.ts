import { createHash, randomUUID } from "node:crypto";
import { Workbook } from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as assets } from "@/app/api/integrations/1c/assets/registry/route";
import { GET as materials } from "@/app/api/integrations/1c/materials/registry/route";
import { GET as exportAnalytics } from "@/app/api/integrations/1c/analytics/export/route";
import { GET as matched } from "@/app/api/integrations/1c/analytics/matched/route";
import { GET as candidates } from "@/app/api/integrations/1c/batches/[id]/rows/[externalId]/candidates/route";
import { POST as analyze } from "@/app/api/integrations/1c/batches/[id]/analyze/route";
import { GET as batchRows } from "@/app/api/integrations/1c/batches/[id]/rows/route";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { PostgresOneCFixedAssetRepository } from "@/lib/server/persistence/postgres/postgres-one-c-fixed-assets-repository";
import { PostgresOneCMaterialsRepository } from "@/lib/server/persistence/postgres/postgres-one-c-materials-repository";
import { authenticatedRequest } from "./support/http-request";
import { database, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

function metadata() { return { sourceSha256: createHash("sha256").update(randomUUID()).digest("hex"), requestId: randomUUID(), sourceFilename: "registry-http.xml" }; }
async function upload(values: OneCFixedAsset[]) {
  const meta = metadata();
  await new PostgresOneCFixedAssetRepository(database).saveBatch(values, meta);
  return (await database.query("select id from yu_inventory.one_c_import_batches where source_sha256=$1", [meta.sourceSha256])).rows[0].id as string;
}
function asset(name: string, overrides: Partial<OneCFixedAsset> = {}): OneCFixedAsset {
  return { externalId: randomUUID(), code: randomUUID(), name, inventoryNumber: null, barcode: null, category: null, location: null, responsibleName: null, responsibleExternalId: null, quantity: 1, residualCost: 10, status: "Принято к учёту", acceptedAt: null, updatedAt: null, ...overrides };
}
describe("1C registry endpoints with PostgreSQL", () => {
  let admin: { userId: string; role: "admin" };
  let employee: { userId: string; role: "employee" };
  beforeAll(async () => {
    resetApplicationServicesForTests(); await setupTmcTransferDatabase();
    const f = await seedFixture(0);
    await database.query("update yu_inventory.users set role='admin' where id=$1", [f.initiatorId]);
    admin = { userId: f.initiatorId, role: "admin" };
    employee = { userId: f.recipientIds[0]!, role: "employee" };
  });
  afterAll(async () => { resetApplicationServicesForTests(); await teardownTmcTransferDatabase(); });

  it("filters current OS stock, searches literal wildcard characters and preserves total beyond the last page", async () => {
    const key = randomUUID();
    const onBook = asset(`${key} literal%_`);
    const offBook = asset(`${key} retired`, { status: "Снято с учёта" });
    const decoy = asset(`${key} literalXY`);
    await upload([onBook, offBook, decoy]);
    const get = async (query: string) => {
      const response = await assets(authenticatedRequest(`/api/integrations/1c/assets/registry?${query}`, admin));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      return response.json();
    };
    expect((await get(`search=${encodeURIComponent(key)}`)).data.map((row: { external_id: string }) => row.external_id).sort()).toEqual([onBook.externalId, decoy.externalId].sort());
    expect((await get(`scope=all&search=${key}`)).total).toBe(3);
    const literal = await get(`search=${encodeURIComponent(`${key} literal%_`)}`);
    expect(literal.data.map((row: { external_id: string }) => row.external_id)).toEqual([onBook.externalId]);
    const beyond = await get(`search=${key}&scope=all&page=2`);
    expect(beyond).toMatchObject({ data: [], total: 3, page: 2 });
  });

  it("searches positive material balances without treating percent or underscore as SQL wildcards", async () => {
    const key = randomUUID();
    const base: OneCMaterial = { externalId: null, code: key, name: `${key} literal%_`, warehouseExternalId: null, warehouseCode: "01", warehouseName: "HTTP warehouse", inventoryNumber: null, barcode: null, unit: "шт", quantity: "7", unitPrice: "12.50", currency: "KZT" };
    await new PostgresOneCMaterialsRepository(database).saveSnapshot({ snapshotAt: "2026-11-01T00:00:00Z", materials: [base, { ...base, code: key + "zero", quantity: "0" }, { ...base, code: key + "negative", quantity: "-1" }, { ...base, code: key + "decoy", name: `${key} literalXY` }] }, metadata());
    const get = async (suffix: string) => {
      const response = await materials(authenticatedRequest(`/api/integrations/1c/materials/registry?${suffix}`, admin));
      expect(response.status).toBe(200);
      return response.json();
    };
    const literal = await get(`search=${encodeURIComponent(`${key} literal%_`)}`);
    expect(literal.total).toBe(1);
    expect(literal.data[0].payload).toMatchObject({ code: key, quantity: "7", unitPrice: "12.50" });
    expect(await get(`search=${key}&page=2`)).toMatchObject({ data: [], total: 2 });
  });

  it.each([
    ["assets", assets], ["materials", materials], ["matched", matched], ["export", exportAnalytics],
  ] as const)("denies %s data to employees and revoked administrator sessions", async (name, endpoint) => {
    const path = `/api/integrations/1c/${name}`;
    const denied = await endpoint(authenticatedRequest(path, employee));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toContain("no-store");
    const revoked = await endpoint(authenticatedRequest(path, { ...admin, sessionVersion: 0 }));
    expect(revoked.status).toBe(401);
  });

  it("finds a real item by each independent candidate identifier and keeps absent fields neutral", async () => {
    const f = await seedFixture(2);
    const itemId = f.itemIds[0]!;
    const number = `HTTP-${randomUUID().slice(0, 8)}`;
    await database.query("update yu_inventory.items set inventory_number=$2::varchar,inventory_number_key=lower($2::text),one_c_code='00042' where id=$1", [itemId, number]);
    for (const identifiers of [{ code: " 00042 ", inventoryNumber: null }, { code: "NO-MATCH", inventoryNumber: number }, { code: "NO-MATCH", inventoryNumber: null, barcode: number }]) {
      const row = asset("Candidate from HTTP", identifiers);
      const id = await upload([row]);
      const response = await candidates(authenticatedRequest(`/api/integrations/1c/batches/${id}/rows/${row.externalId}/candidates`, admin), { params: Promise.resolve({ id, externalId: row.externalId }) });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await response.json()).candidates.map((item: { id: string }) => item.id)).toEqual([itemId]);
    }
    const absent = asset("No matching identifiers", { code: null });
    const id = await upload([absent]);
    const response = await candidates(authenticatedRequest(`/api/integrations/1c/batches/${id}/rows/${absent.externalId}/candidates`, admin), { params: Promise.resolve({ id, externalId: absent.externalId }) });
    expect(response.status).toBe(200);
    expect((await response.json()).candidates).toEqual([]);
  });

  it("requires analysis for the missing list and persists a dry-run without changing Inventory", async () => {
    const value = asset("Missing projector");
    const id = await upload([value]);
    const path = `/api/integrations/1c/batches/${id}`;
    const context = { params: Promise.resolve({ id }) };
    const missingBefore = await batchRows(authenticatedRequest(`${path}/rows?match=missing`, admin), context);
    expect(missingBefore.status).toBe(409);
    const before = (await database.query("select id,version,name from yu_inventory.items order by id")).rows;
    const response = await analyze(authenticatedRequest(`${path}/analyze`, admin, { body: { version: 1 } }), context);
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await batchRows(authenticatedRequest(`${path}/rows?match=missing`, admin), context);
    expect(after.status).toBe(200);
    expect((await after.json()).rows.data.map((row: { external_id: string }) => row.external_id)).toContain(value.externalId);
    expect((await database.query("select id,version,name from yu_inventory.items order by id")).rows).toEqual(before);
  });

  it("exports an actual workbook containing active Inventory and excludes archived or nonactive cards", async () => {
    const f = await seedFixture(3);
    await database.query("update yu_inventory.items set status='maintenance' where id=$1", [f.itemIds[1]]);
    await database.query("update yu_inventory.items set archived_at=now(),archived_by=$2 where id=$1", [f.itemIds[2], admin.userId]);
    const response = await exportAnalytics(authenticatedRequest("/api/integrations/1c/analytics/export", admin));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const workbook = new Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const values: string[] = [];
    workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(String(cell.value)))));
    const numbers = (await database.query("select id,inventory_number from yu_inventory.items where id=any($1::uuid[])", [f.itemIds])).rows;
    for (const row of numbers) expect(values.includes(row.inventory_number)).toBe(row.id === f.itemIds[0]);
  });
});
