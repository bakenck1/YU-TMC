import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppendResponsibilityAuditRecord,
  InventoryResponsibilityRepositories,
  InventoryResponsibilityRepository,
  TransferRecord,
} from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { ApplicationError } from "../lib/domain/application-error";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const REQUESTER_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const PROPOSED_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";
const ACTOR = {
  userId: REQUESTER_ID,
  role: "employee" as const,
  sessionVersion: 7,
};

function createHarness(
  initial: TransferRecord = pendingTransfer(),
  overrides: Partial<InventoryResponsibilityRepository> = {},
) {
  let transfer = structuredClone(initial);
  const audits: AppendResponsibilityAuditRecord[] = [];
  const cancellationInputs: unknown[] = [];
  const transactionOptions: unknown[] = [];
  const repository: Partial<InventoryResponsibilityRepository> = {
    findAuthorizationUserForUpdate: async (userId) => ({
      id: userId,
      role: "employee",
      active: true,
      deletedAt: null,
      version: 7,
    }),
    findTransferForCancellation: async (id, requestedBy) =>
      transfer.id === id && transfer.requestedBy === requestedBy
        ? transfer
        : null,
    cancelTransfer: async (input) => {
      cancellationInputs.push(input);
      if (
        transfer.id !== input.id ||
        transfer.version !== input.version ||
        transfer.status !== "pending_current_owner" ||
        transfer.requestedBy !== input.requestedBy
      ) return null;
      transfer = {
        ...transfer,
        status: "cancelled",
        closedAt: input.closedAt,
        version: transfer.version + 1,
      };
      return transfer;
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
    ...overrides,
  };
  const repositories = {
    responsibility: repository as InventoryResponsibilityRepository,
  } satisfies InventoryResponsibilityRepositories;
  const unitOfWork: UnitOfWork<InventoryResponsibilityRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work, options) => {
      transactionOptions.push(options);
      return work(repositories);
    },
  };
  return {
    audits,
    cancellationInputs,
    service: new InventoryResponsibilityService(
      unitOfWork,
      { now: () => new Date("2026-08-13T08:00:00.000Z") },
      { create: () => "66666666-6666-4666-8666-666666666666" },
    ),
    transactionOptions,
  };
}

test("only the live requester can cancel and the mutation remains actor-bound", async () => {
  const harness = createHarness();

  const result = await harness.service.cancelTransfer(
    TRANSFER_ID.toUpperCase(),
    1,
    { ...ACTOR, userId: ACTOR.userId.toUpperCase() },
  );

  assert.equal(result.status, "cancelled");
  assert.equal(result.version, 2);
  assert.equal(result.direction, "outgoing");
  assert.equal("currentResponsibleIdAtRequest" in result, false);
  assert.deepEqual(harness.cancellationInputs, [{
    id: TRANSFER_ID,
    version: 1,
    requestedBy: REQUESTER_ID,
    closedBy: REQUESTER_ID,
    closedAt: new Date("2026-08-13T08:00:00.000Z"),
  }]);
  assert.deepEqual(harness.transactionOptions, [{
    isolation: "serializable",
    maxAttempts: 3,
  }]);
  assert.deepEqual(harness.audits, [{
    id: "66666666-6666-4666-8666-666666666666",
    actorId: REQUESTER_ID,
    actorRole: "employee",
    subjectKind: "transfer",
    subjectId: TRANSFER_ID,
    subjectRevision: 2,
    action: "transfer.cancelled",
    beforeValues: { status: "pending_current_owner" },
    afterValues: { status: "cancelled" },
    reason: null,
    isAdministrativeException: false,
    occurredAt: new Date("2026-08-13T08:00:00.000Z"),
  }]);
});

test("missing, foreign and malformed cancellation scopes remain uniformly hidden", async () => {
  const harness = createHarness();
  for (const [id, actor] of [
    ["not-a-uuid", ACTOR],
    ["77777777-7777-4777-8777-777777777777", ACTOR],
    [TRANSFER_ID, { ...ACTOR, userId: OTHER_ID }],
  ] as const) {
    await assert.rejects(
      harness.service.cancelTransfer(id, 1, actor),
      hiddenTransfer,
    );
  }
  assert.equal(harness.cancellationInputs.length, 0);
  assert.equal(harness.audits.length, 0);
});

test("administrator, captured owner, proposed actor and non-employee roles cannot cancel", async () => {
  let mutations = 0;
  const harness = createHarness(pendingTransfer(), {
    findAuthorizationUserForUpdate: async (userId) => ({
      id: userId,
      role: userId === REQUESTER_ID ? "warehouse" : userId === OTHER_ID ? "admin" : "employee",
      active: true,
      deletedAt: null,
      version: 7,
    }),
    cancelTransfer: async () => {
      mutations += 1;
      throw new Error("must_not_mutate");
    },
  });
  const actors = [
    { userId: OTHER_ID, role: "admin" as const, sessionVersion: 7 },
    { userId: OWNER_ID, role: "employee" as const, sessionVersion: 7 },
    { userId: PROPOSED_ID, role: "employee" as const, sessionVersion: 7 },
    { userId: REQUESTER_ID, role: "warehouse" as const, sessionVersion: 7 },
  ];
  for (const actor of actors) {
    await assert.rejects(
      harness.service.cancelTransfer(TRANSFER_ID, 1, actor),
      hiddenTransfer,
    );
  }
  assert.equal(mutations, 0);
});

test("cancellation reauthorizes active state, deletion, role and session version in the transaction", async () => {
  const deniedUsers = [
    { id: REQUESTER_ID, role: "employee" as const, active: false, deletedAt: null, version: 7 },
    { id: REQUESTER_ID, role: "employee" as const, active: true, deletedAt: new Date(), version: 7 },
    { id: REQUESTER_ID, role: "employee" as const, active: true, deletedAt: null, version: 8 },
    { id: REQUESTER_ID, role: "warehouse" as const, active: true, deletedAt: null, version: 7 },
  ];
  for (const currentUser of deniedUsers) {
    let lookups = 0;
    const harness = createHarness(pendingTransfer(), {
      findAuthorizationUserForUpdate: async () => currentUser,
      findTransferForCancellation: async () => {
        lookups += 1;
        return pendingTransfer();
      },
    });
    await assert.rejects(
      harness.service.cancelTransfer(TRANSFER_ID, 1, ACTOR),
      hiddenTransfer,
    );
    assert.equal(lookups, 0);
    assert.equal(harness.cancellationInputs.length, 0);
  }
});

test("state/version CAS makes duplicate or racing cancellation side-effect safe", async () => {
  const harness = createHarness();
  await harness.service.cancelTransfer(TRANSFER_ID, 1, ACTOR);

  await assert.rejects(
    harness.service.cancelTransfer(TRANSFER_ID, 1, ACTOR),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "conflict" &&
      error.publicCode === "transfer_not_pending",
  );
  assert.equal(harness.audits.length, 1);

  const lostCas = createHarness(pendingTransfer(), {
    cancelTransfer: async () => null,
  });
  await assert.rejects(
    lostCas.service.cancelTransfer(TRANSFER_ID, 1, ACTOR),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "conflict" &&
      error.publicCode === "version_conflict",
  );
  assert.equal(lostCas.audits.length, 0);
});

test("cancellation rejects invalid actor/session and version bounds before mutation", async () => {
  const harness = createHarness();
  const hiddenActors = [
    { ...ACTOR, userId: "invalid" },
    { ...ACTOR, sessionVersion: 0 },
    { ...ACTOR, sessionVersion: 1.5 },
  ];
  for (const actor of hiddenActors) {
    await assert.rejects(
      harness.service.cancelTransfer(TRANSFER_ID, 1, actor),
      hiddenTransfer,
    );
  }
  for (const version of [0, 1.5, 2_147_483_648]) {
    await assert.rejects(
      harness.service.cancelTransfer(TRANSFER_ID, version, ACTOR),
      (error) =>
        error instanceof ApplicationError &&
        error.kind === "validation" &&
        error.publicCode === "invalid_version",
    );
  }
  assert.equal(harness.cancellationInputs.length, 0);
});

function pendingTransfer(): TransferRecord {
  return {
    id: TRANSFER_ID,
    itemId: "88888888-8888-4888-8888-888888888888",
    requestedBy: REQUESTER_ID,
    requestedByName: "Requester",
    proposedResponsibleId: PROPOSED_ID,
    currentResponsibleIdAtRequest: OWNER_ID,
    currentResponsibleName: "Owner",
    status: "pending_current_owner",
    requestedAt: new Date("2026-08-13T07:00:00.000Z"),
    closedAt: null,
    decisionComment: null,
    version: 1,
  };
}

function hiddenTransfer(error: unknown) {
  return (
    error instanceof ApplicationError &&
    error.kind === "not_found" &&
    error.publicCode === "transfer_not_found"
  );
}
