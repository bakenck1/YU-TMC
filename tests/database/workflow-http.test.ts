import { createECDH, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as createLoss, GET as listLosses } from "@/app/api/inventory/loss-cases/route";
import { POST as uploadReceipt, GET as readReceipt } from "@/app/api/inventory/loss-cases/[id]/receipt/route";
import { POST as reviewLoss } from "@/app/api/inventory/loss-cases/[id]/review/route";
import { POST as createRequest, GET as listRequests } from "@/app/api/service-requests/route";
import { PATCH as updateRequest } from "@/app/api/service-requests/[id]/route";
import { POST as createInspection, GET as listInspections } from "@/app/api/inventory/inspections/route";
import { POST as addRoom } from "@/app/api/inventory/inspections/[id]/rooms/route";
import { POST as recordResult } from "@/app/api/inventory/inspections/[id]/rooms/[roomId]/results/route";
import { POST as addComment } from "@/app/api/inventory/items/[id]/comments/route";
import { GET as attachment } from "@/app/api/inventory/items/[id]/comments/[commentId]/attachments/[attachmentId]/route";
import { POST as subscribe, DELETE as unsubscribe } from "@/app/api/push/subscriptions/route";
import { POST as createItem } from "@/app/api/inventory/items/route";
import { PATCH as patchItem } from "@/app/api/inventory/items/[id]/route";
import { POST as createRoom } from "@/app/api/inventory/buildings/[id]/rooms/route";
import { getApplicationServices, resetApplicationServicesForTests } from "@/lib/server/application";
import { authenticatedRequest } from "./support/http-request";
import { database, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: () => undefined }));
const context = (id: string) => ({ params: Promise.resolve({ id }) });
async function fixture() {
  const f = await seedFixture(1);
  await database.query("update yu_inventory.users set role='admin' where id=$1", [f.recipientIds[0]]);
  const room = (await database.query("select room_id from yu_inventory.items where id=$1", [f.itemIds[0]])).rows[0];
  const building = (await database.query("select building_id from yu_inventory.rooms where id=$1", [room.room_id])).rows[0];
  return { ...f, itemId: f.itemIds[0]!, roomId: room.room_id as string, buildingId: building.building_id as string, admin: { userId: f.recipientIds[0]!, role: "admin" as const }, employee: { userId: f.initiatorId, role: "employee" as const }, outsider: { userId: f.recipientIds[1]!, role: "employee" as const } };
}
let photo: { imageDataUrl: string; width: number; height: number };
describe("workflow endpoints persist authorized transitions", () => {
  beforeAll(async () => {
    const vapid = createECDH("prime256v1");
    vapid.generateKeys();
    vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", vapid.getPublicKey().toString("base64url"));
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", vapid.getPrivateKey().toString("base64url"));
    vi.stubEnv("WEB_PUSH_VAPID_SUBJECT", "mailto:integration@example.test");
    resetApplicationServicesForTests(); await setupTmcTransferDatabase();
    const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "blue" } }).jpeg().toBuffer();
    photo = { imageDataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`, width: 4, height: 3 };
  });
  afterAll(async () => { resetApplicationServicesForTests(); await teardownTmcTransferDatabase(); vi.unstubAllEnvs(); });

  it("creates a decimal-safe loss, stores its receipt and closes exactly its responsibility on approval", async () => {
    const f = await fixture();
    await database.query("update yu_inventory.items set unit_price=120.50 where id=$1", [f.itemId]);
    const base = "/api/inventory/loss-cases";
    const response = await createLoss(authenticatedRequest(base, f.employee, { body: { itemId: f.itemId } }));
    expect(response.status, await response.clone().text()).toBe(201);
    const { lossCase } = await response.json();
    expect(lossCase.amount).toBe("120.50");
    const hidden = await uploadReceipt(authenticatedRequest(`${base}/${lossCase.id}/receipt`, f.outsider, { body: { photo: { imageDataUrl: photo.imageDataUrl } } }), context(lossCase.id));
    expect(hidden.status).toBe(404);
    expect((await uploadReceipt(authenticatedRequest(`${base}/${lossCase.id}/receipt`, f.employee, { body: { photo: { imageDataUrl: photo.imageDataUrl } } }), context(lossCase.id))).status).toBe(200);
    const receipt = await readReceipt(authenticatedRequest(`${base}/${lossCase.id}/receipt`, f.employee), context(lossCase.id));
    expect(receipt.status).toBe(200);
    expect((await sharp(Buffer.from(await receipt.arrayBuffer())).metadata()).format).toBe("jpeg");
    const approved = await reviewLoss(authenticatedRequest(`${base}/${lossCase.id}/review`, f.admin, { body: { decision: "approved" } }), context(lossCase.id));
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect((await approved.json()).lossCase.status).toBe("closed");
    expect((await database.query("select responsibility_period_id,status,amount::text from yu_inventory.asset_loss_cases where id=$1", [lossCase.id])).rows).toEqual([{ responsibility_period_id: f.periodIds[0], status: "closed", amount: "120.50" }]);
    expect((await database.query("select ended_at is not null as closed from yu_inventory.responsibility_periods where id=$1", [f.periodIds[0]])).rows).toEqual([{ closed: true }]);
    expect((await database.query("select from_status,to_status from yu_inventory.asset_loss_case_events where loss_case_id=$1 order by occurred_at,id", [lossCase.id])).rows.map(row => [row.from_status, row.to_status])).toEqual([[null, "payment_pending"], ["payment_pending", "accounting_review"], ["accounting_review", "closed"]]);
  });

  it("denies financial mutations after session revocation without creating a case", async () => {
    const f = await fixture();
    await database.query("update yu_inventory.users set version=version+1 where id=$1", [f.initiatorId]);
    const response = await createLoss(authenticatedRequest("/api/inventory/loss-cases", f.employee, { body: { itemId: f.itemId } }));
    expect(response.status).toBe(401);
    expect((await database.query("select id from yu_inventory.asset_loss_cases where item_id=$1", [f.itemId])).rows).toEqual([]);
    const list = await listLosses(authenticatedRequest("/api/inventory/loss-cases", f.employee));
    expect(list.status).toBe(401);
    expect(list.headers.get("cache-control")).toContain("no-store");
  });

  it("creates an internal service request with its own image, scopes the feed and serializes status races", async () => {
    const f = await fixture();
    const base = "/api/service-requests";
    const input = { itemId: f.itemId, type: "not_working", description: "HTTP repair", photo };
    const noPhoto = await createRequest(authenticatedRequest(base, f.employee, { body: { ...input, photo: undefined } }));
    expect(noPhoto.status).toBe(400);
    const created = await createRequest(authenticatedRequest(base, f.employee, { body: input }));
    expect(created.status, await created.clone().text()).toBe(201);
    const { request } = await created.json();
    const stored = (await database.query("select photo_binary_data from yu_inventory.service_requests where id=$1", [request.id])).rows[0];
    expect((await sharp(stored.photo_binary_data).metadata()).format).toBe("jpeg");
    const hidden = await listRequests(authenticatedRequest(base, f.outsider));
    expect(hidden.status).toBe(200);
    expect((await hidden.json()).requests).toEqual([]);
    expect(hidden.headers.get("cache-control")).toContain("no-store");
    const patch = () => updateRequest(authenticatedRequest(`${base}/${request.id}`, f.admin, { method: "PATCH", body: { status: "in_progress", version: request.version } }), context(request.id));
    const results = await Promise.all([patch(), patch()]);
    expect(results.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await database.query("select status,version from yu_inventory.service_requests where id=$1", [request.id])).rows).toEqual([{ status: "in_progress", version: request.version + 1 }]);
    const before = (await database.query("select count(*)::int n from yu_inventory.audit_records where subject_id=$1", [request.id])).rows;
    await database.query("update yu_inventory.users set role='employee',version=version+1 where id=$1", [f.admin.userId]);
    const denied = await updateRequest(authenticatedRequest(`${base}/${request.id}`, f.admin, { method: "PATCH", body: { status: "completed", version: request.version + 1 } }), context(request.id));
    expect(denied.status).toBe(401);
    expect((await database.query("select count(*)::int n from yu_inventory.audit_records where subject_id=$1", [request.id])).rows).toEqual(before);
  });

  it("creates an inspection, adds its real cabinet and records only a valid scoped item result", async () => {
    const f = await fixture();
    const base = "/api/inventory/inspections";
    const response = await createInspection(authenticatedRequest(base, f.admin, { body: { name: "HTTP inspection", technicianId: f.employee.userId } }));
    expect(response.status, await response.clone().text()).toBe(201);
    const { inspection } = await response.json();
    const added = await addRoom(authenticatedRequest(`${base}/${inspection.id}/rooms`, f.admin, { body: { buildingId: f.buildingId, roomId: f.roomId } }), context(inspection.id));
    expect(added.status, await added.clone().text()).toBe(201);
    const { room } = await added.json();
    const resultPath = `${base}/${inspection.id}/rooms/${room.id}/results`;
    const scope = { params: Promise.resolve({ id: inspection.id, roomId: room.id }) };
    const invalid = await recordResult(authenticatedRequest(resultPath, f.employee, { body: { itemId: "invalid", result: "found" } }), scope);
    expect(invalid.status).toBe(400);
    const foreign = await recordResult(authenticatedRequest(resultPath, f.outsider, { body: { itemId: f.itemId, result: "present" } }), scope);
    expect(foreign.status).toBe(404);
    const recorded = await recordResult(authenticatedRequest(resultPath, f.employee, { body: { itemId: f.itemId, result: "present" } }), scope);
    expect(recorded.status, await recorded.clone().text()).toBe(201);
    const { result } = await recorded.json();
    expect(result.itemId).toBe(f.itemId);
    const saved = await listInspections(authenticatedRequest(base, f.admin));
    expect(saved.status).toBe(200);
    expect((await saved.json()).inspections.some((entry: { id: string }) => entry.id === inspection.id)).toBe(true);
    expect((await database.query("select item_id from yu_inventory.item_results where inspection_room_id=$1", [room.id])).rows).toEqual([{ item_id: f.itemId }]);
  });

  it("downloads exact attachment bytes only through their real item and comment ancestry", async () => {
    const f = await fixture();
    const path = `/api/inventory/items/${f.itemId}/comments`;
    const form = new FormData();
    form.set("message", "Evidence from HTTP");
    form.set("attachment", new File(["actual evidence"], "evidence.txt", { type: "text/plain" }));
    const request = new Request(authenticatedRequest(path, f.employee, { method: "POST" }), { body: form });
    const created = await addComment(request, context(f.itemId));
    expect(created.status, await created.clone().text()).toBe(201);
    const payload = await created.json();
    const comment = payload.comments.find((entry: { message: string }) => entry.message === "Evidence from HTTP");
    const scope = { id: f.itemId, commentId: comment.id as string, attachmentId: comment.attachment.id as string };
    const read = (params = scope, actor = f.employee) => attachment(authenticatedRequest(comment.attachment.downloadUrl, actor), { params: Promise.resolve(params) });
    const bytes = await read();
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("actual evidence");
    expect(bytes.headers.get("content-type")).toBe("application/octet-stream");
    expect(bytes.headers.get("content-disposition")).toContain("evidence.txt");
    expect(bytes.headers.get("cache-control")).toContain("no-store");
    expect(bytes.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await read({ ...scope, commentId: randomUUID() })).status).toBe(404);
    expect((await read({ ...scope, id: randomUUID() })).status).toBe(404);
    expect((await read(scope, f.outsider)).status).toBe(200);
    await database.query("update yu_inventory.rooms set access_mode='closed' where id=$1", [f.roomId]);
    expect((await read(scope, f.outsider)).status).toBe(404);
  });

  it("binds and removes a browser push subscription only for its authenticated owner", async () => {
    const f = await fixture();
    const path = "/api/push/subscriptions";
    const endpoint = `https://fcm.googleapis.com/subscription/${randomUUID()}`;
    const response = await subscribe(authenticatedRequest(path, f.employee, { body: { endpoint, expirationTime: null, keys: { p256dh: "P".repeat(65), auth: "A".repeat(22) }, language: "en", userId: f.outsider.userId } }));
    expect(response.status, await response.clone().text()).toBe(204);
    const stored = () => database.query("select user_id,language from yu_inventory.web_push_subscriptions where endpoint=$1", [endpoint]);
    expect((await stored()).rows).toEqual([{ user_id: f.employee.userId, language: "en" }]);
    expect((await unsubscribe(authenticatedRequest(path, f.outsider, { method: "DELETE", body: { endpoint } }))).status).toBe(204);
    expect((await stored()).rows).toHaveLength(1);
    expect((await unsubscribe(authenticatedRequest(path, f.employee, { method: "DELETE", body: { endpoint } }))).status).toBe(204);
    expect((await stored()).rows).toEqual([]);
  });

  it("requires a separate repair photo and leaves the primary item image unchanged", async () => {
    const f = await fixture();
    const response = await createItem(authenticatedRequest("/api/inventory/items", f.admin, { body: { name: "Photographed component", category: "components", roomId: f.roomId, responsibleUserId: f.employee.userId, photo } }));
    expect(response.status, await response.clone().text()).toBe(201);
    const { item } = await response.json();
    const original = (await database.query("select id,binary_data from yu_inventory.photos where item_id=$1 and purpose='item'", [item.id])).rows;
    expect(original).toHaveLength(1);
    const input = { operation: "send_to_service", version: item.version, serviceName: "Workshop", reason: "Needs repair" };
    const path = `/api/inventory/items/${item.id}`;
    const invalid = await patchItem(authenticatedRequest(path, f.employee, { method: "PATCH", body: input }), context(item.id));
    expect(invalid.status).toBe(400);
    const repaired = await patchItem(authenticatedRequest(path, f.employee, { method: "PATCH", body: { ...input, photo } }), context(item.id));
    expect(repaired.status, await repaired.clone().text()).toBe(200);
    expect((await repaired.json()).item.status).toBe("maintenance");
    expect((await database.query("select id,binary_data from yu_inventory.photos where item_id=$1 and purpose='item'", [item.id])).rows).toEqual(original);
    expect((await database.query("select id from yu_inventory.photos where item_id=$1 and purpose='service_request'", [item.id])).rows).toHaveLength(1);
  });

  it("creates a cabinet without an assignee and retains historical movement labels after the live rooms are renamed", async () => {
    const f = await fixture();
    const path = `/api/inventory/buildings/${f.buildingId}/rooms`;
    const response = await createRoom(authenticatedRequest(path, f.admin, { body: { designation: "202", floorNumber: 2, primaryResponsibleId: null } }), context(f.buildingId));
    expect(response.status, await response.clone().text()).toBe(201);
    const { room } = await response.json();
    expect((await database.query("select primary_responsible_id from yu_inventory.rooms where id=$1", [room.id])).rows).toEqual([{ primary_responsible_id: null }]);
    const item = (await database.query("select inventory_number,version from yu_inventory.items where id=$1", [f.itemId])).rows[0];
    const moved = await patchItem(authenticatedRequest(`/api/inventory/items/${f.itemId}`, f.admin, { method: "PATCH", body: { version: item.version, roomId: room.id, inventoryNumber: item.inventory_number, status: "active" } }), context(f.itemId));
    expect(moved.status, await moved.clone().text()).toBe(200);
    await database.query("update yu_inventory.rooms set designation='999' where id=$1", [room.id]);
    await database.query("update yu_inventory.buildings set name='Renamed current building' where id=$1", [f.buildingId]);
    const operations = await getApplicationServices().items.listOperations(f.itemId, f.admin);
    const movement = operations.find(entry => entry.detail?.toLocation?.includes("202"));
    expect(movement?.detail?.fromLocation).toContain("Transaction Room");
    expect(movement?.detail?.toLocation).toContain("Transaction Building");
    expect(JSON.stringify(movement)).not.toContain("Renamed current building");
    expect(movement?.detail?.toLocation).not.toContain("999");
  });
});
