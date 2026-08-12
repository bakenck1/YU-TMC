import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildTmcRequestDecisions,
  createTmcRequestSelection,
  shouldRetainTmcDecisionAttempt,
  toggleTmcRequestSelection,
} from "../lib/tmc-transfer-request-card";
import type { TmcTransferRequestDto } from "../lib/contracts/tmc-operations";

test("request selection starts with pending items only and cannot add terminal items", () => {
  const request = requestDto();
  let selection = createTmcRequestSelection(request, true);
  assert.deepEqual([...selection], [request.items[0].id]);
  selection = toggleTmcRequestSelection(selection, request.items[1], true);
  assert.deepEqual([...selection], [request.items[0].id]);
  selection = toggleTmcRequestSelection(selection, request.items[0], true);
  assert.deepEqual([...selection], []);
  assert.deepEqual([...createTmcRequestSelection(request, false)], []);
});

test("decision retry retains its idempotency key only for uncertain outcomes", () => {
  assert.equal(shouldRetainTmcDecisionAttempt(503, "upstream_unavailable"), true);
  assert.equal(shouldRetainTmcDecisionAttempt(409, "idempotency_request_in_progress"), true);
  assert.equal(shouldRetainTmcDecisionAttempt(409, "version_conflict"), false);
  assert.equal(shouldRetainTmcDecisionAttempt(400, "invalid_request"), false);
});

test("accept-all ignores checkboxes while selected explicitly rejects unchecked pending items", () => {
  const request = requestDto();
  const none = new Set<string>();
  assert.deepEqual(buildTmcRequestDecisions(request, none, "all").map((item) => item.decision), ["accept"]);
  assert.deepEqual(buildTmcRequestDecisions(request, none, "selected").map((item) => item.decision), ["reject"]);
  const selected = new Set([request.items[0].id]);
  assert.deepEqual(buildTmcRequestDecisions(request, selected, "selected").map((item) => item.decision), ["accept"]);
  assert.equal(buildTmcRequestDecisions(request, selected, "selected")[0]?.itemVersion, request.items[0].version);
});

test("group request card exposes all required read-only metadata accessibly", () => {
  const source = [
    "components/TmcTransferRequestCard.tsx",
    "components/TmcRequestItemResultBadge.tsx",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  const page = readFileSync("app/(protected)/tmc/transfer-requests/[id]/page.tsx", "utf8");
  assert.match(source, /type="checkbox"/);
  assert.match(source, /item\.responsibleUserProfile/);
  assert.match(source, /request\.recipient/);
  assert.match(source, /request\.initiator/);
  assert.match(source, /request\.comment/);
  assert.match(source, /showOverdue && request\.overdue/);
  assert.match(page, /key=\{`\$\{request\.id\}:\$\{request\.version\}`\}/);
  for (const result of ["pending", "accepted", "rejected", "cancelled", "invalidated"]) {
    assert.match(source, new RegExp(`tmc\\.request\\.item\\.${result}`));
  }
  assert.match(source, /<time/);
  assert.match(source, /item\.item\.photoUrl/);
  assert.match(source, /min-h-11/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(source, /tmc\.request\.acceptAll/);
  assert.match(source, /tmc\.request\.acceptSelected/);
  assert.match(source, /window\.confirm/);
});

function requestDto(): TmcTransferRequestDto {
  const actor = { id: uuid(1), fullName: "Actor", email: "a@example.com", role: "employee" as const };
  const recipient = { id: uuid(2), fullName: "Recipient", email: "r@example.com", role: "employee" as const };
  const item = (index: number, result: "pending" | "accepted") => ({
    id: uuid(index + 10), requestId: uuid(5), item: { id: uuid(index + 20), name: `Item ${index}`, inventoryNumber: `INV-${index}`, quantity: 1, unitPrice: 100, photoUrl: null, location: { buildingId: uuid(30), buildingName: "B", roomId: uuid(31), roomDesignation: "1" } },
    responsibilityPeriodIdAtRequest: uuid(index + 40), currentResponsibleIdAtRequest: actor.id, responsibleUserProfile: actor,
    createdAt: "2026-08-10T00:00:00.000Z", version: 1,
    ...(result === "pending" ? { result, invalidReason: null, decidedAt: null, decidedBy: null } : { result, invalidReason: null, decidedAt: "2026-08-10T01:00:00.000Z", decidedBy: recipient }),
  });
  return { id: uuid(5), initiator: actor, recipient, comment: "Comment", createdAt: "2026-08-10T00:00:00.000Z", expiresAt: "2026-08-11T00:00:00.000Z", overdue: false, version: 1, summary: { total: 2, pending: 1, accepted: 1, rejected: 0, cancelled: 0, invalidated: 0 }, items: [item(1, "pending"), item(2, "accepted")], status: "pending", closedAt: null, closedBy: null, isAdministrativeDecision: false, administrativeReason: null };
}

function uuid(value: number) { return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`; }
