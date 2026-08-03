import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { InventoryResponsibilityRepository, TransferRecord } from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { canAccessPath } from "../lib/security/authorization";

const owner = { userId: "11111111-1111-4111-8111-111111111111", role: "employee" as const };
const requester = { userId: "22222222-2222-4222-8222-222222222222", role: "employee" as const };

test("employee QR transfer request is only completed by the captured owner", async () => {
  let currentOwner = owner.userId;
  let transfer: TransferRecord | null = null;
  const auditActions: string[] = [];
  const repository = {
    findItemState: async () => ({ itemId: "item-1", responsibleUserId: currentOwner, responsibleName: "Owner", itemStatus: "active" as const }),
    isUserActiveForUpdate: async () => true,
    findPendingTransfer: async () => transfer?.status === "pending_current_owner" ? transfer : null,
    insertTransfer: async (input) => transfer = { ...input, requestedByName: "Requester", currentResponsibleName: "Owner", status: "pending_current_owner", closedAt: null, decisionComment: null, version: 1 },
    appendAudit: async (input) => { auditActions.push(input.action); },
    findTransfer: async () => transfer,
    decideTransfer: async (input) => {
      if (!transfer || transfer.version !== input.version) return null;
      transfer = { ...transfer, status: input.status, closedAt: input.closedAt, decisionComment: input.decisionComment, version: transfer.version + 1 };
      return transfer;
    },
    closeResponsibility: async () => { currentOwner = ""; },
    insertResponsibility: async (input) => { currentOwner = input.responsibleUserId; },
    listTransfersForUser: async () => transfer ? [transfer] : [],
  } as unknown as InventoryResponsibilityRepository;
  const unitOfWork = {
    transaction: (work) => work({ responsibility: repository }),
    read: (work) => work({ responsibility: repository }),
  } as UnitOfWork<{ responsibility: InventoryResponsibilityRepository }>;
  let id = 0;
  const service = new InventoryResponsibilityService(unitOfWork, { now: () => new Date("2026-08-03T10:00:00Z") }, { create: () => `id-${++id}` });

  const created = await service.requestTransfer({ itemId: "item-1" }, requester);
  assert.equal(created.direction, "outgoing");
  const inbox = await service.listTransfers(owner);
  assert.equal(inbox[0]?.direction, "incoming");
  await service.decideTransfer(created.id, { version: 1, decision: "confirm" }, owner);

  assert.equal(currentOwner, requester.userId);
  assert.deepEqual(auditActions, ["transfer.requested", "transfer.confirmed"]);
});

test("confirmed transfer is exposed in the admin item timeline", async () => {
  const transfer: TransferRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    itemId: "44444444-4444-4444-8444-444444444444",
    requestedBy: requester.userId,
    requestedByName: "Requester",
    proposedResponsibleId: requester.userId,
    currentResponsibleIdAtRequest: owner.userId,
    currentResponsibleName: "Owner",
    status: "confirmed",
    requestedAt: new Date("2026-08-03T09:00:00Z"),
    closedAt: new Date("2026-08-03T10:00:00Z"),
    decisionComment: null,
    version: 2,
  };
  const repository = {
    findItemState: async () => ({ itemId: transfer.itemId, responsibleUserId: requester.userId, responsibleName: "Requester", itemStatus: "active" as const }),
    listTimeline: async () => [{ id: transfer.id, kind: "transfer" as const, occurredAt: transfer.requestedAt, actorName: transfer.requestedByName, responsibleName: transfer.currentResponsibleName, status: transfer.status, detail: null, closedAt: transfer.closedAt }],
  } as unknown as InventoryResponsibilityRepository;
  const run = (work: (repositories: { responsibility: InventoryResponsibilityRepository }) => unknown) =>
    work({ responsibility: repository });
  const unitOfWork = {
    read: run,
    transaction: run,
  } as UnitOfWork<{ responsibility: InventoryResponsibilityRepository }>;
  const service = new InventoryResponsibilityService(unitOfWork, { now: () => new Date("2026-08-03T10:00:00Z") }, { create: () => "unused" });
  const timeline = await service.listTimeline(transfer.itemId, { userId: owner.userId, role: "admin" });
  assert.equal(timeline[0]?.kind, "transfer");
  assert.equal(timeline[0]?.status, "confirmed");
});

test("transfers page is employee-only and exposes the complete QR workflow", async () => {
  assert.equal(canAccessPath("employee", "/transfers"), true);
  assert.equal(canAccessPath("admin", "/transfers"), false);
  assert.equal(canAccessPath("warehouse", "/transfers"), false);
  const source = await readFile("components/InventoryTransfersManager.tsx", "utf8");
  assert.match(source, /\/api\/inventory\/qr\/resolve/);
  assert.match(source, /Запросить передачу/);
  assert.match(source, /\/decision/);
  assert.match(source, /Подтвердить/);
  assert.match(source, /Отклонить/);
});
