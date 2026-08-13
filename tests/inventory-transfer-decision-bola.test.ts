import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppendResponsibilityAuditRecord,
  InventoryResponsibilityRepositories,
  InventoryResponsibilityRepository,
  ItemResponsibilityState,
  TransferRecord,
} from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { ApplicationError } from "../lib/domain/application-error";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const REQUESTER_ID = "66666666-6666-4666-8666-666666666666";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const PERIOD_ID = "77777777-7777-4777-8777-777777777777";

function createService(
  transfer: TransferRecord,
  overrides: Partial<InventoryResponsibilityRepository> = {},
) {
  const repositories = {
    responsibility: {
      findTransfer: async () => transfer,
      findTransferForDecision: async (id: string, actorId: string) =>
        id === transfer.id && actorId === transfer.currentResponsibleIdAtRequest
          ? transfer
          : null,
      findAuthorizationUserForUpdate: async () => ({
        id: OWNER_ID,
        role: "employee" as const,
        active: true,
        deletedAt: null,
        version: 1,
      }),
      findItemState: async () => activeItem(),
      findItemStateForUpdate: async () => activeItem(),
      isUserActiveForUpdate: async () => true,
      decideTransfer: async (input) => ({
        ...transfer,
        status: input.status,
        closedAt: input.closedAt,
        decisionComment: input.decisionComment,
        version: transfer.version + 1,
      }),
      closeResponsibility: async () => true,
      insertResponsibility: async () => undefined,
      appendAudit: async () => undefined,
      ...overrides,
    } as InventoryResponsibilityRepository,
  } satisfies InventoryResponsibilityRepositories;
  const unitOfWork: UnitOfWork<InventoryResponsibilityRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryResponsibilityService(
    unitOfWork,
    { now: () => new Date("2026-08-03T12:00:00.000Z") },
    { create: () => "44444444-4444-4444-8444-444444444444" },
  );
}

test("does not reveal the state of another owner's transfer", async () => {
  const service = createService({
    id: TRANSFER_ID,
    itemId: ITEM_ID,
    requestedBy: OTHER_EMPLOYEE_ID,
    requestedByName: "Requester",
    proposedResponsibleId: OTHER_EMPLOYEE_ID,
    currentResponsibleIdAtRequest: OWNER_ID,
    currentResponsibleName: "Owner",
    status: "confirmed",
    requestedAt: new Date("2026-08-01T12:00:00.000Z"),
    closedAt: new Date("2026-08-02T12:00:00.000Z"),
    decisionComment: null,
    version: 2,
  });

  await assert.rejects(
    service.decideTransfer(
      TRANSFER_ID,
      { version: 2, decision: "confirm" },
      { userId: OTHER_EMPLOYEE_ID, role: "employee", sessionVersion: 1 },
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "not_found" &&
      error.publicCode === "transfer_not_found",
  );
});

test("reauthorizes the owner and session version inside the decision transaction", async () => {
  let mutations = 0;
  const service = createService(pendingTransfer(), {
    findAuthorizationUserForUpdate: async () => ({
      id: OWNER_ID,
      role: "employee",
      active: true,
      deletedAt: null,
      version: 2,
    }),
    decideTransfer: async () => {
      mutations += 1;
      throw new Error("must not mutate");
    },
  });

  await assert.rejects(
    service.decideTransfer(
      TRANSFER_ID,
      { version: 1, decision: "confirm" },
      { userId: OWNER_ID, role: "employee", sessionVersion: 1 },
    ),
    hiddenTransfer,
  );
  assert.equal(mutations, 0);
});

test("does not transfer an inactive item even when the captured owner still matches", async () => {
  let mutations = 0;
  const service = createService(pendingTransfer(), {
    findItemState: async () => ({ ...activeItem(), itemStatus: "decommissioned" }),
    findItemStateForUpdate: async () => ({
      ...activeItem(),
      itemStatus: "decommissioned",
    }),
    decideTransfer: async () => {
      mutations += 1;
      throw new Error("must not mutate");
    },
  });

  await assert.rejects(
    service.decideTransfer(
      TRANSFER_ID,
      { version: 1, decision: "confirm" },
      { userId: OWNER_ID, role: "employee", sessionVersion: 1 },
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "conflict" &&
      error.publicCode === "responsibility_changed",
  );
  assert.equal(mutations, 0);
});

test("does not assign a requester who is no longer an eligible employee", async () => {
  let mutations = 0;
  const service = createService(pendingTransfer(), {
    findAuthorizationUserForUpdate: async (userId) =>
      userId === OWNER_ID
        ? {
            id: OWNER_ID,
            role: "employee",
            active: true,
            deletedAt: null,
            version: 1,
          }
        : {
            id: REQUESTER_ID,
            role: "warehouse",
            active: true,
            deletedAt: null,
            version: 2,
          },
    decideTransfer: async () => {
      mutations += 1;
      throw new Error("must not mutate");
    },
  });

  await assert.rejects(
    service.decideTransfer(
      TRANSFER_ID,
      { version: 1, decision: "confirm" },
      { userId: OWNER_ID, role: "employee", sessionVersion: 1 },
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "conflict" &&
      error.publicCode === "proposed_responsible_unavailable",
  );
  assert.equal(mutations, 0);
});

test("reject reason is canonical, bounded and audit-linked to the new revision", async () => {
  const auditRecords: AppendResponsibilityAuditRecord[] = [];
  const service = createService(pendingTransfer(), {
    appendAudit: async (record) => {
      auditRecords.push(record);
    },
  });

  const result = await service.decideTransfer(
    TRANSFER_ID,
    { version: 1, decision: "reject", comment: "  Duplicate\u00a0asset  " },
    { userId: OWNER_ID, role: "employee", sessionVersion: 1 },
  );

  assert.equal(result.decisionComment, "Duplicate asset");
  const auditRecord = auditRecords[0];
  assert.equal(auditRecord?.subjectRevision, 2);
  assert.equal(auditRecord?.reason, "Duplicate asset");
  assert.equal(auditRecord?.isAdministrativeException, false);
});

test("reject reason blocks database-hostile and deceptive Unicode", async () => {
  const service = createService(pendingTransfer());
  for (const comment of ["reason\u0000suffix", "\u200b\u2060", "reason\ud800"]) {
    await assert.rejects(
      service.decideTransfer(
        TRANSFER_ID,
        { version: 1, decision: "reject", comment },
        { userId: OWNER_ID, role: "employee", sessionVersion: 1 },
      ),
      (error) =>
        error instanceof ApplicationError &&
        error.kind === "validation" &&
        error.publicCode === "comment_required",
    );
  }
});

function pendingTransfer(): TransferRecord {
  return {
    id: TRANSFER_ID,
    itemId: ITEM_ID,
    requestedBy: REQUESTER_ID,
    requestedByName: "Requester",
    proposedResponsibleId: REQUESTER_ID,
    currentResponsibleIdAtRequest: OWNER_ID,
    currentResponsibleName: "Owner",
    status: "pending_current_owner",
    requestedAt: new Date("2026-08-01T12:00:00.000Z"),
    closedAt: null,
    decisionComment: null,
    version: 1,
  };
}

function activeItem(): ItemResponsibilityState {
  return {
    itemId: ITEM_ID,
    responsibilityPeriodId: PERIOD_ID,
    responsibleUserId: OWNER_ID,
    responsibleName: "Owner",
    itemStatus: "active",
  };
}

function hiddenTransfer(error: unknown) {
  return (
    error instanceof ApplicationError &&
    error.kind === "not_found" &&
    error.publicCode === "transfer_not_found"
  );
}
