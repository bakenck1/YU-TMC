import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { InventoryResponsibilityRepository, TransferRecord } from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { ApplicationError } from "../lib/domain/application-error";
import { canAccessPath } from "../lib/security/authorization";

const owner = { userId: "11111111-1111-4111-8111-111111111111", role: "employee" as const };
const requester = { userId: "22222222-2222-4222-8222-222222222222", role: "employee" as const };

test("employee QR transfer request is only completed by the captured owner", async () => {
  let currentOwner = owner.userId;
  let transfer: TransferRecord | null = null;
  const auditActions: string[] = [];
  let closedExpectation: { expectedResponsibilityPeriodId: string; expectedResponsibleUserId: string } | null = null;
  const repository = {
    findItemState: async () => ({ itemId: "item-1", responsibilityPeriodId: "period-1", responsibleUserId: currentOwner, responsibleName: "Owner", itemStatus: "active" as const }),
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
    closeResponsibility: async (input) => {
      closedExpectation = input;
      if (input.expectedResponsibilityPeriodId !== "period-1" || input.expectedResponsibleUserId !== currentOwner) {
        throw new Error("open_responsibility_not_found");
      }
      currentOwner = "";
      return true;
    },
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
  assert.equal(closedExpectation?.expectedResponsibilityPeriodId, "period-1");
  assert.equal(closedExpectation?.expectedResponsibleUserId, owner.userId);
  assert.deepEqual(auditActions, ["transfer.requested", "transfer.confirmed"]);
});

test("legacy transfer close is CAS-scoped to the responsibility period it read", async () => {
  const source = await readFile("lib/server/persistence/postgres/postgres-inventory-responsibility-repositories.ts", "utf8");
  assert.match(source, /where id = \$1 and item_id = \$2 and responsible_user_id = \$3/);
  assert.doesNotMatch(source, /where item_id = \$1 and ended_at is null/);
});

test("legacy transfer maps a lost responsibility CAS to 409 and rolls its decision back", async () => {
  let transfer: TransferRecord = {
    id: "33333333-3333-4333-8333-333333333333",
    itemId: "44444444-4444-4444-8444-444444444444",
    requestedBy: requester.userId,
    requestedByName: "Requester",
    proposedResponsibleId: requester.userId,
    currentResponsibleIdAtRequest: owner.userId,
    currentResponsibleName: "Owner",
    status: "pending_current_owner",
    requestedAt: new Date("2026-08-03T09:00:00Z"),
    closedAt: null,
    decisionComment: null,
    version: 1,
  };
  let inserted = false;
  const repository = {
    findTransfer: async () => transfer,
    findItemState: async () => ({ itemId: transfer.itemId, responsibilityPeriodId: "period-old", responsibleUserId: owner.userId, responsibleName: "Owner", itemStatus: "active" as const }),
    isUserActiveForUpdate: async () => true,
    decideTransfer: async (input) => {
      transfer = { ...transfer, status: input.status, closedAt: input.closedAt, version: 2 };
      return transfer;
    },
    closeResponsibility: async () => false,
    insertResponsibility: async () => { inserted = true; },
  } as unknown as InventoryResponsibilityRepository;
  const unitOfWork = {
    read: (work) => work({ responsibility: repository }),
    transaction: async (work) => {
      const before = structuredClone(transfer);
      try { return await work({ responsibility: repository }); }
      catch (error) { transfer = before; throw error; }
    },
  } as UnitOfWork<{ responsibility: InventoryResponsibilityRepository }>;
  const service = new InventoryResponsibilityService(unitOfWork, { now: () => new Date("2026-08-03T10:00:00Z") }, { create: () => "unused" });
  await assert.rejects(
    service.decideTransfer(transfer.id, { version: 1, decision: "confirm" }, owner),
    (error: unknown) => error instanceof ApplicationError && error.kind === "conflict" && error.publicCode === "responsibility_changed",
  );
  assert.equal(transfer.status, "pending_current_owner");
  assert.equal(inserted, false);
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
    findItemState: async () => ({ itemId: transfer.itemId, responsibilityPeriodId: "period-1", responsibleUserId: requester.userId, responsibleName: "Requester", itemStatus: "active" as const }),
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
  const source = await Promise.all([
    "components/InventoryTransfersManager.tsx",
    "components/InventoryTransferList.tsx",
  ].map((path) => readFile(path, "utf8"))).then((sources) => sources.join("\n"));
  assert.match(source, /\/api\/inventory\/qr\/resolve/);
  assert.match(source, /Запросить передачу/);
  assert.match(source, /\/decision/);
  assert.match(source, /Подтвердить/);
  assert.match(source, /Отклонить/);
});
