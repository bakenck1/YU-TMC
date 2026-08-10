import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { TmcTransferHistoryDto } from "../lib/contracts/tmc-operations";
import { toTmcHistoryPageView } from "../lib/tmc-history-view";

const page = readFileSync(
  new URL("../app/(protected)/tmc/history/page.tsx", import.meta.url),
  "utf8",
);
const component = readFileSync(
  new URL("../components/TmcHistory.tsx", import.meta.url),
  "utf8",
);

test("history page does not serialize the full transfer request DTO into the client RSC payload", () => {
  assert.doesNotMatch(page, /requests=\{result\.requests\}/);
  assert.doesNotMatch(component, /TmcTransferRequestDto/);
  assert.match(page, /toTmcHistoryPageView/);
});

test("history client projection omits unused identities, prices, photos, versions, and authorization snapshots", () => {
  const history = {
    requests: [{
      id: "11111111-1111-4111-8111-111111111111",
      initiator: { id: "22222222-2222-4222-8222-222222222222", fullName: "Initiator", email: "secret-initiator@example.test", role: "admin" },
      recipient: { id: "33333333-3333-4333-8333-333333333333", fullName: "Recipient", email: "secret-recipient@example.test", role: "employee" },
      status: "pending",
      comment: "secret-request-comment",
      createdAt: "2026-08-10T12:00:00.000Z",
      expiresAt: "2026-08-11T12:00:00.000Z",
      overdue: false,
      version: 7,
      summary: { total: 1, pending: 1, accepted: 0, rejected: 0, cancelled: 0, invalidated: 0 },
      items: [{
        id: "44444444-4444-4444-8444-444444444444",
        requestId: "11111111-1111-4111-8111-111111111111",
        item: {
          id: "55555555-5555-4555-8555-555555555555",
          name: "Laptop",
          inventoryNumber: "INV-1",
          quantity: 99,
          unitPrice: 999_999,
          photoUrl: "/secret-photo",
          location: {
            buildingId: "66666666-6666-4666-8666-666666666666",
            buildingName: "Building",
            roomId: "77777777-7777-4777-8777-777777777777",
            roomDesignation: "101",
          },
        },
        responsibilityPeriodIdAtRequest: "88888888-8888-4888-8888-888888888888",
        currentResponsibleIdAtRequest: "99999999-9999-4999-8999-999999999999",
        responsibleUserProfile: { id: "99999999-9999-4999-8999-999999999999", fullName: "Owner", email: "secret-owner@example.test", role: "employee" },
        result: "pending",
        invalidReason: null,
        createdAt: "2026-08-10T12:00:00.000Z",
        decidedAt: null,
        decidedBy: null,
        version: 4,
      }],
      closedAt: null,
      closedBy: null,
      isAdministrativeDecision: false,
      administrativeReason: null,
    }],
    locationChanges: [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      itemId: "secret-location-item-id",
      itemName: "Laptop",
      inventoryNumber: "INV-1",
      actorId: "secret-location-actor-id",
      actorName: "Administrator",
      beforeRoomId: "secret-before-room-id",
      beforeLocation: "Building / 101",
      afterRoomId: "secret-after-room-id",
      afterLocation: "Building / 102",
      comment: "move",
      occurredAt: "2026-08-10T12:00:00.000Z",
    }],
    nextRequestCursor: "secret-request-cursor",
    nextLocationCursor: "secret-location-cursor",
  } as TmcTransferHistoryDto;

  const serialized = JSON.stringify(toTmcHistoryPageView(history));
  for (const secret of [
    "secret-initiator@example.test",
    "secret-recipient@example.test",
    "secret-owner@example.test",
    "secret-request-comment",
    "/secret-photo",
    "secret-location-item-id",
    "secret-location-actor-id",
    "secret-before-room-id",
    "secret-after-room-id",
    "secret-request-cursor",
    "secret-location-cursor",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(serialized.includes("999999"), false);
});
