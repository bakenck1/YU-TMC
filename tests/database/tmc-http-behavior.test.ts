import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as create, GET as history } from "@/app/api/inventory/transfer-requests/route";
import { POST as decide } from "@/app/api/inventory/transfer-requests/[id]/decision/route";
import { POST as cancel } from "@/app/api/inventory/transfer-requests/[id]/cancel/route";
import { GET as detail } from "@/app/api/inventory/transfer-requests/[id]/route";
import { GET as photo } from "@/app/api/inventory/transfer-requests/[id]/items/[itemId]/photo/route";
import { GET as notifications } from "@/app/api/inventory/notifications/route";
import { POST as markRead } from "@/app/api/inventory/notifications/[id]/read/route";
import { POST as markAllRead } from "@/app/api/inventory/notifications/read-all/route";
import type { TmcTransferRequestDto } from "@/lib/contracts/tmc-operations";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { authenticatedRequest } from "./support/http-request";
import {
  database, requestCount, seedFixture,
  setupTmcTransferDatabase, teardownTmcTransferDatabase,
} from "./support/tmc-transfer-request-database";

// Next's response lifecycle and external notifications require a running server.
// Domain services, session validation, transactions and SQL remain real.
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: () => {},
}));

const base = "/api/inventory/transfer-requests";
type Fixture = Awaited<ReturnType<typeof seedFixture>>;
function actor(userId: string) { return { userId, role: "employee" as const }; }
function context(id: string) { return { params: Promise.resolve({ id }) }; }
async function createRequest(fixture: Fixture, itemIds = fixture.itemIds) {
  const response = await create(authenticatedRequest(base, actor(fixture.initiatorId), {
    key: randomUUID(), body: { recipientId: fixture.recipientIds[0], itemIds },
  }));
  expect(response.status).toBe(201);
  return (await response.json()).result.request as TmcTransferRequestDto;
}
async function owners(itemIds: string[]) {
  const result = await database.query(
    `select item_id, responsible_user_id from yu_inventory.responsibility_periods
      where item_id = any($1::uuid[]) and ended_at is null order by item_id`, [itemIds],
  );
  return result.rows;
}

describe("TMC endpoints with PostgreSQL and signed sessions", () => {
  beforeAll(async () => {
    resetApplicationServicesForTests();
    await setupTmcTransferDatabase();
  });
  afterAll(async () => {
    resetApplicationServicesForTests();
    await teardownTmcTransferDatabase();
  });

  it("replays creation after a fresh HTTP request and rejects reuse for another payload", async () => {
    const fixture = await seedFixture(2);
    const before = await requestCount();
    const key = randomUUID();
    const body = { recipientId: fixture.recipientIds[0], itemIds: [fixture.itemIds[0]] };
    const post = (payload: unknown) => create(authenticatedRequest(base, actor(fixture.initiatorId), { body: payload, key }));
    const first = await post(body);
    expect(first.status).toBe(201);
    const result = await first.json();
    const replay = await post(body);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.json()).toEqual(result);
    const conflict = await post({ ...body, itemIds: [fixture.itemIds[1]] });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "idempotency_key_reused" });
    expect(await requestCount()).toBe(before + 1);
    const children = await database.query(
      "select item_id from yu_inventory.tmc_transfer_request_items where request_id=$1", [result.result.request.id],
    );
    expect(children.rows).toEqual([{ item_id: fixture.itemIds[0] }]);
  });

  it("hides another participant's request in detail and filtered history", async () => {
    const fixture = await seedFixture(1);
    const request = await createRequest(fixture);
    const stranger = actor(fixture.recipientIds[1]!);
    const hidden = await detail(authenticatedRequest(`${base}/${request.id}`, stranger), context(request.id));
    const missingId = randomUUID();
    const missing = await detail(authenticatedRequest(`${base}/${missingId}`, stranger), context(missingId));
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(hidden.status);
    expect(await hidden.json()).toEqual(await missing.json());
    const response = await history(authenticatedRequest(`${base}?itemId=${fixture.itemIds[0]}`, stranger));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(request.id);
    const own = await detail(authenticatedRequest(`${base}/${request.id}`, actor(fixture.recipientIds[0]!)), context(request.id));
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ request: { id: request.id } });
  });

  it("commits mixed decisions, replays them and changes only the accepted responsibility", async () => {
    const fixture = await seedFixture(2);
    const request = await createRequest(fixture);
    const key = randomUUID();
    const body = {
      requestVersion: request.version,
      decisions: request.items.map((entry, index) => ({
        itemId: entry.item.id, itemVersion: entry.version,
        decision: index === 0 ? "accept" : "reject",
      })),
    };
    const post = (payload = body) => decide(authenticatedRequest(`${base}/${request.id}/decision`, actor(fixture.recipientIds[0]!), { key, body: payload }), context(request.id));
    const response = await post();
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json();
    expect(result.request.summary).toMatchObject({ pending: 0, accepted: 1, rejected: 1 });
    const replay = await post({ ...body, decisions: [...body.decisions].reverse().map(({ itemId, itemVersion, decision }) => ({ decision, itemVersion, itemId })) });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect(await owners(fixture.itemIds)).toEqual(expect.arrayContaining([
      { item_id: request.items[0]!.item.id, responsible_user_id: fixture.recipientIds[0] },
      { item_id: request.items[1]!.item.id, responsible_user_id: fixture.initiatorId },
    ]));
    const periods = await database.query(
      "select id from yu_inventory.responsibility_periods where item_id=$1", [request.items[0]!.item.id],
    );
    expect(periods.rows).toHaveLength(2);
  });

  it("rejects foreign decisions and revoked sessions without changing responsibility", async () => {
    const fixture = await seedFixture(1);
    const request = await createRequest(fixture);
    const before = await owners(fixture.itemIds);
    const body = { requestVersion: request.version, decisions: [{ itemId: fixture.itemIds[0], itemVersion: 1, decision: "accept" }] };
    const stranger = await decide(authenticatedRequest(`${base}/${request.id}/decision`, actor(fixture.recipientIds[1]!), { key: randomUUID(), body }), context(request.id));
    expect(stranger.status).toBe(404);
    await database.query("update yu_inventory.users set version=version+1 where id=$1", [fixture.recipientIds[0]]);
    const revoked = await decide(authenticatedRequest(`${base}/${request.id}/decision`, actor(fixture.recipientIds[0]!), { key: randomUUID(), body }), context(request.id));
    expect(revoked.status).toBe(401);
    expect(await owners(fixture.itemIds)).toEqual(before);
    const state = await database.query("select status from yu_inventory.tmc_transfer_requests where id=$1", [request.id]);
    expect(state.rows).toEqual([{ status: "pending" }]);
  });

  it("cancels a pending request without undoing an earlier accepted transfer", async () => {
    const fixture = await seedFixture(2);
    const request = await createRequest(fixture, [fixture.itemIds[0]!]);
    const accepted = request.items[0]!;
    const decision = await decide(authenticatedRequest(`${base}/${request.id}/decision`, actor(fixture.recipientIds[0]!), {
      key: randomUUID(), body: { requestVersion: request.version, decisions: [{ itemId: accepted.item.id, itemVersion: accepted.version, decision: "accept" }] },
    }), context(request.id));
    expect(decision.status, await decision.clone().text()).toBe(200);
    const pending = await createRequest(fixture, [fixture.itemIds[1]!]);
    const key = randomUUID();
    const post = () => cancel(authenticatedRequest(`${base}/${pending.id}/cancel`, actor(fixture.initiatorId), { key, body: { requestVersion: pending.version } }), context(pending.id));
    const response = await post();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.request.summary).toMatchObject({ accepted: 0, cancelled: 1, pending: 0 });
    const replay = await post();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect(await owners(fixture.itemIds)).toEqual(expect.arrayContaining([
      { item_id: accepted.item.id, responsible_user_id: fixture.recipientIds[0] },
      { item_id: pending.items[0]!.item.id, responsible_user_id: fixture.initiatorId },
    ]));
  });

  it("returns JPEG bytes only for a participant's item inside the specified request", async () => {
    const fixture = await seedFixture(2);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    for (const itemId of fixture.itemIds) {
      await database.query(
        `insert into yu_inventory.photos(id,purpose,status,uploaded_by,original_object_key,preview_object_key,
          trusted_mime_type,byte_size,width,height,checksum_sha256,reserved_at,expires_at,attached_at,item_id,binary_data)
         values($1,'item','attached',$2,$3,$4,'image/jpeg',$5,1,1,$6,now(),now()+interval '1 hour',now(),$7,$8)`,
        [randomUUID(), fixture.initiatorId, `test/original/${itemId}`, `test/preview/${itemId}`, bytes.length, "0".repeat(64), itemId, bytes],
      );
    }
    const request = await createRequest(fixture, [fixture.itemIds[0]!]);
    const get = (userId: string, itemId: string) => photo(
      authenticatedRequest(`${base}/${request.id}/items/${itemId}/photo`, actor(userId)),
      { params: Promise.resolve({ id: request.id, itemId }) },
    );
    const response = await get(fixture.recipientIds[0]!, fixture.itemIds[0]!);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect((await get(fixture.recipientIds[0]!, fixture.itemIds[1]!)).status).toBe(404);
    expect((await get(fixture.recipientIds[1]!, fixture.itemIds[0]!)).status).toBe(404);
  });

  it("persists notification read state and prevents another user from marking it read", async () => {
    const fixture = await seedFixture(2);
    const requests = [await createRequest(fixture, [fixture.itemIds[0]!]), await createRequest(fixture, [fixture.itemIds[1]!])];
    const recipient = actor(fixture.recipientIds[0]!);
    const feed = async () => {
      const response = await notifications(authenticatedRequest("/api/inventory/notifications", recipient));
      expect(response.status).toBe(200);
      return response.json();
    };
    const initial = await feed();
    expect(initial.unreadCount).toBe(2);
    expect(initial.notifications.map((entry: { requestId: string }) => entry.requestId).sort()).toEqual(requests.map((r) => r.id).sort());
    const id = initial.notifications[0].id as string;
    const path = `/api/inventory/notifications/${id}/read`;
    const foreign = await markRead(authenticatedRequest(path, actor(fixture.recipientIds[1]!), { method: "POST" }), context(id));
    expect(foreign.status).toBe(404);
    expect((await feed()).unreadCount).toBe(2);
    expect((await markRead(authenticatedRequest(path, recipient, { method: "POST" }), context(id))).status).toBe(204);
    expect((await feed()).unreadCount).toBe(1);
    expect((await markAllRead(authenticatedRequest("/api/inventory/notifications/read-all", recipient, { method: "POST" }))).status).toBe(204);
    expect((await feed()).unreadCount).toBe(0);
  });
});
