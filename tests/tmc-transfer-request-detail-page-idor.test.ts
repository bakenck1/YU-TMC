import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { TmcTransferRequestDto } from "../lib/contracts/tmc-operations";
import { toTmcTransferRequestCardView } from "../lib/tmc-transfer-request-detail-view";

const pageSource = readFileSync(
  new URL("../app/(protected)/tmc/transfer-requests/[id]/page.tsx", import.meta.url),
  "utf8",
);
const cardSource = readFileSync(
  new URL("../components/TmcTransferRequestCard.tsx", import.meta.url),
  "utf8",
);

test("transfer request detail page does not serialize the domain DTO into the client RSC payload", () => {
  assert.match(pageSource, /toTmcTransferRequestCardView\(request\)/);
  assert.doesNotMatch(pageSource, /request=\{request\}/);
  assert.doesNotMatch(cardSource, /TmcTransferRequestDto/);
  assert.match(cardSource, /TmcTransferRequestCardView/);
});

test("transfer request card projection keeps only rendered and mutation-required fields", () => {
  const request: TmcTransferRequestDto = {
    id: "11111111-1111-4111-8111-111111111111",
    initiator: {
      id: "22222222-2222-4222-8222-222222222222",
      fullName: "Initiator",
      email: "initiator@example.test",
      role: "admin",
    },
    recipient: {
      id: "33333333-3333-4333-8333-333333333333",
      fullName: "Recipient",
      email: "recipient@example.test",
      role: "employee",
    },
    status: "pending",
    comment: "Visible comment",
    createdAt: "2026-08-10T10:00:00.000Z",
    expiresAt: "secret-expiry-value",
    overdue: false,
    version: 7,
    summary: {
      total: 1,
      pending: 1,
      accepted: 0,
      rejected: 0,
      cancelled: 0,
      invalidated: 0,
    },
    items: [{
      id: "44444444-4444-4444-8444-444444444444",
      requestId: "secret-redundant-request-id",
      item: {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Laptop",
        inventoryNumber: "INV-42",
        quantity: 2,
        unitPrice: 500_000,
        photoUrl: "/api/inventory/transfer-requests/photo",
        location: {
          buildingId: "secret-building-id",
          buildingName: "Main",
          roomId: "secret-room-id",
          roomDesignation: "101",
        },
      },
      responsibilityPeriodIdAtRequest: "secret-responsibility-period",
      currentResponsibleIdAtRequest: "secret-authorization-owner-id",
      responsibleUserProfile: {
        id: "secret-profile-id",
        fullName: "Owner",
        email: "secret-owner@example.test",
        role: "warehouse",
      },
      result: "pending",
      invalidReason: null,
      createdAt: "secret-item-created-at",
      decidedAt: null,
      decidedBy: null,
      version: 4,
    }],
    closedAt: null,
    closedBy: null,
    isAdministrativeDecision: false,
    administrativeReason: null,
  };

  assert.deepEqual(toTmcTransferRequestCardView(request), {
    id: request.id,
    initiator: {
      fullName: "Initiator",
      email: "initiator@example.test",
    },
    recipient: {
      fullName: "Recipient",
      email: "recipient@example.test",
    },
    status: "pending",
    comment: "Visible comment",
    createdAt: "2026-08-10T10:00:00.000Z",
    overdue: false,
    version: 7,
    summary: { total: 1, pending: 1, accepted: 0 },
    items: [{
      id: "44444444-4444-4444-8444-444444444444",
      item: {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Laptop",
        inventoryNumber: "INV-42",
        quantity: 2,
        unitPrice: 500_000,
        photoUrl: "/api/inventory/transfer-requests/photo",
        location: {
          buildingName: "Main",
          roomDesignation: "101",
        },
      },
      responsibleUserProfile: { fullName: "Owner" },
      result: "pending",
      version: 4,
    }],
  });
});

test("transfer request detail page derives actions from the authenticated actor and authorized aggregate", () => {
  assert.match(
    pageSource,
    /const canDecide = user\.role === "admin" \|\| request\.recipient\.id === user\.userId/,
  );
  assert.match(
    pageSource,
    /const canCancel = user\.role === "admin" \|\| request\.initiator\.id === user\.userId/,
  );
  assert.match(
    pageSource,
    /requiresAdministrativeReason=\{user\.role === "admin" && request\.recipient\.id !== user\.userId\}/,
  );
  assert.match(
    pageSource,
    /requiresCancellationReason=\{user\.role === "admin" && request\.initiator\.id !== user\.userId\}/,
  );
});

test("transfer request detail page uses the shared hidden-object boundary", () => {
  assert.match(
    pageSource,
    /readHiddenPageResource\([\s\S]*?tmcTransferRequests\.getById\([\s\S]*?notFound/,
  );
  assert.doesNotMatch(pageSource, /error\.kind === "not_found"/);
});
