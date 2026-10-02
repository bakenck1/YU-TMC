import assert from "node:assert/strict";
import test from "node:test";

import type { TmcTransferRequestDto, TmcTransferRequestItemDto } from "../lib/contracts/tmc-operations";
import { notifyTmcCreatedByWhatsApp, tmcCreatedWhatsAppNotifications, tmcDecisionWhatsAppNotifications } from "../lib/server/whatsapp-tmc";
import { createTmcTransferRequestPostHandler } from "../lib/server/http/tmc-transfer-request-handler";
import { createTmcTransferRequestDecisionPostHandler } from "../lib/server/http/tmc-transfer-request-decision-handler";

function fixture(claim = false): TmcTransferRequestDto {
  return {
    id: "request-1", status: "pending", isAdministrativeDecision: false,
    initiator: { id: "requester", fullName: "Айбек" }, recipient: { id: "owner", fullName: "Алия" },
    items: [
      { item: { id: "item-1", name: "Стол", inventoryNumber: "123" }, currentResponsibleIdAtRequest: claim ? "owner" : "requester", result: "pending" },
      { item: { id: "item-2", name: "Стул", inventoryNumber: "456" }, currentResponsibleIdAtRequest: claim ? "owner" : "requester", result: "pending" },
    ],
  } as unknown as TmcTransferRequestDto;
}

function decide(request: TmcTransferRequestDto, results: Array<"accepted" | "rejected" | "pending">): void {
  request.items = request.items.map((item, index) => ({ ...item, result: results[index] } as TmcTransferRequestItemDto));
}

test("creation tells the decision maker who requested which goods and confirms submission", () => {
  for (const claim of [true, false]) {
    const notices = tmcCreatedWhatsAppNotifications(fixture(claim));
    assert.deepEqual(notices.map((notice) => [notice.kind, notice.recipientId]), [["tmc_requested", "owner"], ["tmc_submitted", "requester"]]);
    assert.match(notices[0].message!, /Айбек/);
    assert.match(notices[0].message!, /Стол.*123.*Стул.*456/);
    assert.match(notices[0].message!, claim ? /на получение ТМЦ от вас/ : /на передачу ТМЦ вам/);
    assert.match(notices[0].message!, /Примите или отклоните/);
  }
});

test("partial decisions describe only committed items, accept/reject independently, and assign correct owner", () => {
  const request = fixture(false);
  decide(request, ["accepted", "rejected"]);
  const notices = tmcDecisionWhatsAppNotifications(request, ["item-1", "item-2"]);
  assert.deepEqual(notices.map((notice) => [notice.kind, notice.recipientId]), [["tmc_accepted", "requester"], ["responsibility_assigned", "owner"], ["tmc_rejected", "requester"]]);
  assert.match(notices[0].message!, /Стол/);
  assert.doesNotMatch(notices[0].message!, /Стул/);
  assert.match(notices[2].message!, /Стул/);
  assert.doesNotMatch(notices[2].message!, /Стол/);
  assert.deepEqual(tmcDecisionWhatsAppNotifications(request, ["item-2"]).map((notice) => notice.kind), ["tmc_rejected"]);
});

test("accepted claim names the initiator responsible without a duplicate assignment message", () => {
  const request = fixture(true);
  decide(request, ["accepted", "accepted"]);
  const notices = tmcDecisionWhatsAppNotifications(request, ["item-1", "item-2"]);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].recipientId, "requester");
  assert.match(notices[0].message!, /Вы назначены ответственным/);
});

test("case-insensitive command item IDs match the committed normalized projection", () => {
  const request = fixture();
  request.items[0].item.id = "abcdefab-1234-4234-8234-123456789abc";
  decide(request, ["accepted", "pending"]);
  const notices = tmcDecisionWhatsAppNotifications(request, ["ABCDEFAB-1234-4234-8234-123456789ABC"]);
  assert.deepEqual(notices.map((notice) => notice.kind), ["tmc_accepted", "responsibility_assigned"]);
});

test("admin automatic acceptance aggregates assignment and never asks recipient to accept again", () => {
  const request = fixture();
  Object.assign(request, { status: "accepted", isAdministrativeDecision: true });
  decide(request, ["accepted", "accepted"]);
  const notices = tmcCreatedWhatsAppNotifications(request);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, "responsibility_assigned");
  assert.equal(notices[0].recipientId, "owner");
  assert.match(notices[0].message!, /Стол.*Стул/);
  assert.doesNotMatch(notices[0].message!, /Примите или отклоните/);
});

test("failed first recipient does not stop second recipient notification", async () => {
  const recipients: string[] = [];
  await notifyTmcCreatedByWhatsApp(fixture(), async (notice) => {
    recipients.push(notice.recipientId);
    if (notice.recipientId === "owner") throw new Error("unavailable");
  });
  assert.deepEqual(recipients, ["owner", "requester"]);
});

test("admin deciding an existing request notifies requester and correctly attributes mixed decisions", () => {
  const request = fixture();
  Object.assign(request, { status: "accepted", isAdministrativeDecision: true });
  decide(request, ["accepted", "rejected"]);
  const notices = tmcDecisionWhatsAppNotifications(request, ["item-1", "item-2"]);
  assert.deepEqual(notices.map((notice) => notice.kind), ["tmc_accepted", "responsibility_assigned", "tmc_rejected"]);
  assert.equal(notices[0].recipientId, "requester");
  assert.match(notices[0].message!, /Администратор принял/);
  assert.match(notices[2].message!, /Администратор отклонил/);
  assert.doesNotMatch(notices[0].message!, /Алия принял/);
});

test("HTTP notification hooks run only for committed commands and cannot fail their responses", async () => {
  let created = 0;
  let decided = 0;
  for (const kind of ["completed", "replayed"] as const) {
    const create = createTmcTransferRequestPostHandler({
      async authenticate() { return { userId: "requester", role: "employee" }; },
      async createIdempotent() { return { kind, status: 201, body: { result: { request: fixture(), included: 2 } as never } }; },
      onCommitted() { created++; throw new Error("schedule failure"); },
    });
    assert.equal((await create(jsonRequest({ recipientId: "owner", itemIds: ["item-1"] }))).status, 201);
    const decision = createTmcTransferRequestDecisionPostHandler({
      async authenticate() { return { userId: "owner", role: "employee", sessionVersion: 1 }; },
      async decideIdempotent() { return { kind, status: 200, body: { request: fixture() } }; },
      onCompleted(_request, itemIds) { decided++; assert.deepEqual(itemIds, ["item-1"]); throw new Error("schedule failure"); },
    });
    assert.equal((await decision(jsonRequest({ requestVersion: 1, decisions: [{ itemId: "item-1", itemVersion: 1, decision: "accept" }] }), "request-1")).status, 200);
  }
  assert.equal(created, 1);
  assert.equal(decided, 1);
});

function jsonRequest(body: unknown): Request {
  return new Request("https://example.test/api", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "tmc-whatsapp-test-0001" }, body: JSON.stringify(body) });
}
