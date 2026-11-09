import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as list } from "@/app/api/inventory/transfers/route";
import { POST as decide } from "@/app/api/inventory/transfers/[id]/decision/route";
import { POST as cancel } from "@/app/api/inventory/transfers/[id]/cancel/route";
import { resetApplicationServicesForTests } from "@/lib/server/application";
import { authenticatedRequest } from "./support/http-request";
import { database, seedFixture, setupTmcTransferDatabase, teardownTmcTransferDatabase } from "./support/tmc-transfer-request-database";

function actor(userId: string) { return { userId, role: "employee" as const }; }
function context(id: string) { return { params: Promise.resolve({ id }) }; }
const base = "/api/inventory/transfers";
async function fixture() {
  const value = await seedFixture(1);
  const transferId = randomUUID();
  await database.query(
    `insert into yu_inventory.transfers(id,item_id,requested_by,proposed_responsible_id,current_responsible_id_at_request)
      values($1,$2,$3,$3,$4)`, [transferId, value.itemIds[0], value.recipientIds[0], value.initiatorId],
  );
  return { ...value, transferId };
}
async function snapshot(itemId: string) {
  return (await database.query(
    "select responsible_user_id from yu_inventory.responsibility_periods where item_id=$1 and ended_at is null", [itemId],
  )).rows;
}
async function errorCode(response: Response) { return (await response.json()).error as string; }

describe("legacy transfer endpoints with PostgreSQL", () => {
  beforeAll(async () => { resetApplicationServicesForTests(); await setupTmcTransferDatabase(); });
  afterAll(async () => { resetApplicationServicesForTests(); await teardownTmcTransferDatabase(); });

  it("shows transfers only to participants and hides foreign decisions like missing IDs", async () => {
    const f = await fixture();
    const outsider = actor(f.recipientIds[1]!);
    const foreign = await decide(authenticatedRequest(`${base}/${f.transferId}/decision`, outsider, { body: { version: 1, decision: "confirm" } }), context(f.transferId));
    const missingId = randomUUID();
    const missing = await decide(authenticatedRequest(`${base}/${missingId}/decision`, outsider, { body: { version: 1, decision: "confirm" } }), context(missingId));
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe(await errorCode(missing));
    expect(missing.status).toBe(404);
    const hiddenList = await list(authenticatedRequest(base, outsider));
    expect(hiddenList.status).toBe(200);
    expect((await hiddenList.json()).transfers).toEqual([]);
    const ownList = await list(authenticatedRequest(base, actor(f.initiatorId)));
    expect(ownList.status).toBe(200);
    expect((await ownList.json()).transfers.map((t: { id: string }) => t.id)).toContain(f.transferId);
    expect(await snapshot(f.itemIds[0]!)).toEqual([{ responsible_user_id: f.initiatorId }]);
  });

  it("allows only one concurrent confirmation and persists one handoff with its audit", async () => {
    const f = await fixture();
    const post = () => decide(authenticatedRequest(`${base}/${f.transferId}/decision`, actor(f.initiatorId), { body: { version: 1, decision: "confirm" } }), context(f.transferId));
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await snapshot(f.itemIds[0]!)).toEqual([{ responsible_user_id: f.recipientIds[0] }]);
    const periods = await database.query("select id from yu_inventory.responsibility_periods where item_id=$1", [f.itemIds[0]]);
    expect(periods.rows).toHaveLength(2);
    const audit = await database.query("select actor_id,subject_revision,reason from yu_inventory.audit_records where subject_id=$1 and action='transfer.confirmed'", [f.transferId]);
    expect(audit.rows).toEqual([{ actor_id: f.initiatorId, subject_revision: 2, reason: null }]);
  });

  it("preserves ownership after rejection and saves the normalized reason", async () => {
    const f = await fixture();
    const response = await decide(authenticatedRequest(`${base}/${f.transferId}/decision`, actor(f.initiatorId), {
      body: { version: 1, decision: "reject", comment: "  Still needed  " },
    }), context(f.transferId));
    expect(response.status).toBe(200);
    expect(await snapshot(f.itemIds[0]!)).toEqual([{ responsible_user_id: f.initiatorId }]);
    const audit = await database.query("select reason,subject_revision from yu_inventory.audit_records where subject_id=$1 and action='transfer.rejected'", [f.transferId]);
    expect(audit.rows).toEqual([{ reason: "Still needed", subject_revision: 2 }]);
  });

  it("rejects a changed owner snapshot without changing responsibility or writing an audit", async () => {
    const f = await fixture();
    await database.query("update yu_inventory.responsibility_periods set ended_at=now(),ended_by=$2,end_reason='admin_override' where id=$1", [f.periodIds[0], f.initiatorId]);
    await database.query("insert into yu_inventory.responsibility_periods(id,item_id,responsible_user_id,source,started_by) values($1,$2,$3,'admin_override',$3)", [randomUUID(), f.itemIds[0], f.recipientIds[1]]);
    const response = await decide(authenticatedRequest(`${base}/${f.transferId}/decision`, actor(f.initiatorId), { body: { version: 1, decision: "confirm" } }), context(f.transferId));
    expect(response.status).toBe(409);
    expect(await snapshot(f.itemIds[0]!)).toEqual([{ responsible_user_id: f.recipientIds[1] }]);
    expect((await database.query("select id from yu_inventory.audit_records where subject_id=$1", [f.transferId])).rows).toEqual([]);
  });

  it("lets the requester cancel once while foreign users cannot cancel or reveal the transfer", async () => {
    const f = await fixture();
    const request = (userId: string, id = f.transferId) => cancel(authenticatedRequest(`${base}/${id}/cancel`, actor(userId), { body: { version: 1 } }), context(id));
    const foreign = await request(f.recipientIds[1]!);
    const missing = await request(f.recipientIds[1]!, randomUUID());
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await errorCode(foreign)).toBe(await errorCode(missing));
    expect((await request(f.recipientIds[0]!)).status).toBe(200);
    expect((await request(f.recipientIds[0]!)).status).toBe(409);
    expect(await snapshot(f.itemIds[0]!)).toEqual([{ responsible_user_id: f.initiatorId }]);
    const transfer = await database.query("select status,version from yu_inventory.transfers where id=$1", [f.transferId]);
    expect(transfer.rows).toEqual([{ status: "cancelled", version: 2 }]);
    const audits = await database.query("select actor_id,actor_role_snapshot,subject_revision,action,before_values,after_values from yu_inventory.audit_records where subject_id=$1", [f.transferId]);
    expect(audits.rows).toEqual([{
      actor_id: f.recipientIds[0], actor_role_snapshot: "employee", subject_revision: 2,
      action: "transfer.cancelled", before_values: { status: "pending_current_owner" }, after_values: { status: "cancelled" },
    }]);
  });
});
