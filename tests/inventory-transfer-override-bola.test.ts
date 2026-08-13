import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppendResponsibilityAuditRecord,
  InventoryResponsibilityAuthorizationUser,
  InventoryResponsibilityRepositories,
  InventoryResponsibilityRepository,
  ItemResponsibilityState,
  OverrideTransferRecord,
  TransferRecord,
} from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { ApplicationError } from "../lib/domain/application-error";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const PERIOD_ID = "66666666-6666-4666-8666-666666666666";
const ACTOR = { userId: ADMIN_ID, role: "admin" as const, sessionVersion: 7 };

function createHarness(overrides: Partial<InventoryResponsibilityRepository> = {}) {
  let transfer = pendingTransfer();
  const audits: AppendResponsibilityAuditRecord[] = [];
  const closeInputs: unknown[] = [];
  const insertInputs: unknown[] = [];
  const overrideInputs: OverrideTransferRecord[] = [];
  const lookupCalls: string[] = [];
  const transactionOptions: unknown[] = [];
  const users = new Map<string, InventoryResponsibilityAuthorizationUser>([
    [ADMIN_ID, authorizationUser(ADMIN_ID, "admin", 7)],
    [TARGET_ID, authorizationUser(TARGET_ID, "employee", 3)],
    [OWNER_ID, authorizationUser(OWNER_ID, "employee", 2)],
  ]);
  const repository: Partial<InventoryResponsibilityRepository> = {
    findAuthorizationUserForUpdate: async (id) => {
      lookupCalls.push(`user:${id}`);
      return users.get(id) ?? null;
    },
    findTransferForOverride: async (id) => {
      lookupCalls.push(`transfer:${id}`);
      return transfer.id === id ? structuredClone(transfer) : null;
    },
    findItemStateForUpdate: async (id) => {
      lookupCalls.push(`item:${id}`);
      return id === ITEM_ID ? activeItem() : null;
    },
    overrideTransfer: async (input) => {
      overrideInputs.push(input);
      if (
        input.id !== transfer.id ||
        input.expectedItemId !== transfer.itemId ||
        input.expectedResponsibilityPeriodId !== PERIOD_ID ||
        input.expectedCurrentResponsibleId !== OWNER_ID ||
        input.version !== transfer.version ||
        transfer.status !== "pending_current_owner" ||
        input.administratorId !== ADMIN_ID ||
        input.administratorSessionVersion !== 7
      ) return null;
      transfer = {
        ...transfer,
        status: "overridden",
        closedAt: input.closedAt,
        version: transfer.version + 1,
      };
      return structuredClone(transfer);
    },
    closeResponsibility: async (input) => {
      closeInputs.push(input);
      return true;
    },
    insertResponsibility: async (input) => {
      insertInputs.push(input);
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
      const before = structuredClone(transfer);
      try {
        return await work(repositories);
      } catch (error) {
        transfer = before;
        throw error;
      }
    },
  };
  let nextId = 0;
  return {
    audits,
    closeInputs,
    insertInputs,
    lookupCalls,
    overrideInputs,
    transactionOptions,
    users,
    transfer: () => transfer,
    service: new InventoryResponsibilityService(
      unitOfWork,
      { now: () => new Date("2026-08-13T08:00:00.000Z") },
      { create: () => `77777777-7777-4777-8777-${String(++nextId).padStart(12, "0")}` },
    ),
  };
}

test("only the live session-bound database administrator can override any transfer", async () => {
  const denied = [
    authorizationUser(ADMIN_ID, "admin", 7, { active: false }),
    authorizationUser(ADMIN_ID, "admin", 7, { deletedAt: new Date() }),
    authorizationUser(ADMIN_ID, "employee", 7),
    authorizationUser(ADMIN_ID, "admin", 8),
    authorizationUser(TARGET_ID, "admin", 7),
  ];

  for (const currentActor of denied) {
    let transferLookups = 0;
    let mutations = 0;
    const harness = createHarness({
      findAuthorizationUserForUpdate: async () => currentActor,
      findTransferForOverride: async () => {
        transferLookups += 1;
        return pendingTransfer();
      },
      overrideTransfer: async () => {
        mutations += 1;
        throw new Error("must_not_mutate");
      },
    });
    await assert.rejects(
      harness.service.overrideTransfer(TRANSFER_ID, releaseInput(), ACTOR),
      hiddenTransfer,
    );
    assert.equal(transferLookups, 0);
    assert.equal(mutations, 0);
  }
});

test("malformed, missing and non-admin override scopes stay uniformly hidden", async () => {
  const harness = createHarness();
  const nonAdmin = { ...ACTOR, role: "employee" as const };
  harness.users.set(ADMIN_ID, authorizationUser(ADMIN_ID, "employee", 7));

  for (const id of ["not-a-uuid", TRANSFER_ID, "88888888-8888-4888-8888-888888888888"]) {
    await assert.rejects(
      harness.service.overrideTransfer(id, releaseInput(), nonAdmin),
      hiddenTransfer,
    );
  }
  assert.equal(harness.overrideInputs.length, 0);
});

test("assigned override canonicalizes IDs/reason and binds SQL CAS, responsibility and audit", async () => {
  const harness = createHarness();
  const result = await harness.service.overrideTransfer(
    TRANSFER_ID.toUpperCase(),
    {
      version: 1,
      reason: "  Urgent\u00a0compliance override  ",
      outcome: "assigned",
      responsibleUserId: TARGET_ID.toUpperCase(),
    },
    { ...ACTOR, userId: ADMIN_ID.toUpperCase() },
  );

  assert.equal(result.status, "overridden");
  assert.equal(result.version, 2);
  assert.equal(result.direction, "outgoing");
  assert.equal("currentResponsibleIdAtRequest" in result, false);
  assert.deepEqual(harness.lookupCalls, [
    `user:${ADMIN_ID}`,
    `transfer:${TRANSFER_ID}`,
    `item:${ITEM_ID}`,
    `user:${TARGET_ID}`,
  ]);
  assert.deepEqual(harness.overrideInputs, [{
    id: TRANSFER_ID,
    expectedItemId: ITEM_ID,
    expectedResponsibilityPeriodId: PERIOD_ID,
    expectedCurrentResponsibleId: OWNER_ID,
    version: 1,
    administratorId: ADMIN_ID,
    administratorSessionVersion: 7,
    closedAt: new Date("2026-08-13T08:00:00.000Z"),
    administrativeReason: "Urgent compliance override",
    overrideOutcome: "assigned",
    overrideResponsibleId: TARGET_ID,
  }]);
  assert.deepEqual(harness.closeInputs, [{
    itemId: ITEM_ID,
    expectedResponsibilityPeriodId: PERIOD_ID,
    expectedResponsibleUserId: OWNER_ID,
    endedBy: ADMIN_ID,
    endedAt: new Date("2026-08-13T08:00:00.000Z"),
    endReason: "Urgent compliance override",
  }]);
  assert.deepEqual(harness.insertInputs, [{
    id: "77777777-7777-4777-8777-000000000001",
    itemId: ITEM_ID,
    responsibleUserId: TARGET_ID,
    source: "admin_override",
    startedBy: ADMIN_ID,
    startedAt: new Date("2026-08-13T08:00:00.000Z"),
  }]);
  assert.deepEqual(harness.audits, [{
    id: "77777777-7777-4777-8777-000000000002",
    actorId: ADMIN_ID,
    actorRole: "admin",
    subjectKind: "transfer",
    subjectId: TRANSFER_ID,
    subjectRevision: 2,
    action: "transfer.overridden",
    beforeValues: { status: "pending_current_owner" },
    afterValues: {
      status: "overridden",
      outcome: "assigned",
      responsibleUserId: TARGET_ID,
      administrativeReason: "Urgent compliance override",
    },
    reason: "Urgent compliance override",
    isAdministrativeException: true,
    occurredAt: new Date("2026-08-13T08:00:00.000Z"),
  }]);
  assert.deepEqual(harness.transactionOptions, [{ isolation: "serializable", maxAttempts: 3 }]);
});

test("override permits only active non-deleted employee targets and rejects the live owner", async () => {
  const deniedTargets = [
    null,
    authorizationUser(TARGET_ID, "employee", 3, { active: false }),
    authorizationUser(TARGET_ID, "employee", 3, { deletedAt: new Date() }),
    authorizationUser(TARGET_ID, "admin", 3),
    authorizationUser(TARGET_ID, "warehouse", 3),
  ];
  for (const target of deniedTargets) {
    const harness = createHarness({
      findAuthorizationUserForUpdate: async (id) =>
        id === ADMIN_ID ? authorizationUser(ADMIN_ID, "admin", 7) : target,
    });
    await assert.rejects(
      harness.service.overrideTransfer(TRANSFER_ID, assignedInput(), ACTOR),
      (error) => applicationError(error, "validation", "responsible_user_not_available"),
    );
    assert.equal(harness.overrideInputs.length, 0);
  }

  const sameOwner = createHarness();
  await assert.rejects(
    sameOwner.service.overrideTransfer(TRANSFER_ID, {
      ...assignedInput(),
      responsibleUserId: OWNER_ID,
    }, ACTOR),
    (error) => applicationError(error, "conflict", "already_responsible"),
  );
  assert.equal(sameOwner.overrideInputs.length, 0);
});

test("override rejects ambiguous pairing, invalid identifiers, deceptive reasons and int4 versions before writes", async () => {
  const invalidInputs = [
    { ...releaseInput(), responsibleUserId: TARGET_ID },
    { ...assignedInput(), responsibleUserId: undefined },
    { ...assignedInput(), responsibleUserId: "not-a-uuid" },
    { ...releaseInput(), version: 0 },
    { ...releaseInput(), version: 1.5 },
    { ...releaseInput(), version: 2_147_483_648 },
    { ...releaseInput(), reason: "reason\u0000suffix" },
    { ...releaseInput(), reason: "\u200b" },
    { ...releaseInput(), reason: "\u202Ehidden" },
    { ...releaseInput(), reason: "\u0301" },
    { ...releaseInput(), reason: "reason\ud800" },
    { ...releaseInput(), reason: "x".repeat(1_001) },
  ];
  for (const input of invalidInputs) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.overrideTransfer(TRANSFER_ID, input, ACTOR),
      (error) => error instanceof ApplicationError && error.kind === "validation",
    );
    assert.equal(harness.overrideInputs.length, 0);
    assert.equal(harness.lookupCalls.length, 0);
  }
});

test("override rejects a forged runtime outcome before authorization or writes", async () => {
  const harness = createHarness();
  const forgedInput = {
    ...releaseInput(),
    outcome: "confirmed",
  } as unknown as Parameters<
    InventoryResponsibilityService["overrideTransfer"]
  >[1];

  await assert.rejects(
    harness.service.overrideTransfer(TRANSFER_ID, forgedInput, ACTOR),
    (error) => applicationError(error, "validation", "invalid_outcome"),
  );
  assert.equal(harness.lookupCalls.length, 0);
  assert.equal(harness.overrideInputs.length, 0);
  assert.equal(harness.closeInputs.length, 0);
  assert.equal(harness.insertInputs.length, 0);
  assert.equal(harness.audits.length, 0);
});

test("override requires the locked item/responsibility snapshot to belong to the transfer", async () => {
  const invalidStates: Array<ItemResponsibilityState | null> = [
    null,
    { ...activeItem(), itemId: "88888888-8888-4888-8888-888888888888" },
    { ...activeItem(), itemStatus: "decommissioned" },
    { ...activeItem(), responsibleUserId: TARGET_ID },
    {
      ...activeItem(),
      responsibilityPeriodId: null,
      responsibleUserId: null,
    },
    { ...activeItem(), responsibilityPeriodId: null },
    { ...activeItem(), responsibleUserId: null },
  ];
  for (const state of invalidStates) {
    const harness = createHarness({ findItemStateForUpdate: async () => state });
    await assert.rejects(
      harness.service.overrideTransfer(TRANSFER_ID, releaseInput(), ACTOR),
      (error) => applicationError(error, "conflict", "responsibility_changed"),
    );
    assert.equal(harness.overrideInputs.length, 0);
  }
});

test("transfer state/version CAS serializes override against decision, cancel and another override", async () => {
  for (const status of ["confirmed", "rejected", "cancelled", "overridden"] as const) {
    const harness = createHarness({
      findTransferForOverride: async () => ({ ...pendingTransfer(), status }),
    });
    await assert.rejects(
      harness.service.overrideTransfer(TRANSFER_ID, releaseInput(), ACTOR),
      (error) => applicationError(error, "conflict", "transfer_not_pending"),
    );
    assert.equal(harness.overrideInputs.length, 0);
  }

  const lostCas = createHarness({ overrideTransfer: async () => null });
  await assert.rejects(
    lostCas.service.overrideTransfer(TRANSFER_ID, releaseInput(), ACTOR),
    (error) => applicationError(error, "conflict", "version_conflict"),
  );
  assert.equal(lostCas.closeInputs.length, 0);
  assert.equal(lostCas.insertInputs.length, 0);
  assert.equal(lostCas.audits.length, 0);
});

test("a responsibility close CAS failure rolls back the preceding transfer override and audit", async () => {
  const harness = createHarness({ closeResponsibility: async () => false });

  await assert.rejects(
    harness.service.overrideTransfer(TRANSFER_ID, releaseInput(), ACTOR),
    (error) => applicationError(error, "conflict", "responsibility_changed"),
  );

  assert.equal(harness.overrideInputs.length, 1);
  assert.equal(harness.transfer().status, "pending_current_owner");
  assert.equal(harness.transfer().version, 1);
  assert.equal(harness.insertInputs.length, 0);
  assert.equal(harness.audits.length, 0);
});

test("an open-responsibility uniqueness race becomes a stable 409 with no committed override", async () => {
  const harness = createHarness({
    insertResponsibility: async () => {
      throw Object.assign(new Error("duplicate open period"), { code: "23505" });
    },
  });

  await assert.rejects(
    harness.service.overrideTransfer(TRANSFER_ID, assignedInput(), ACTOR),
    (error) => applicationError(error, "conflict", "responsibility_changed"),
  );
  assert.equal(harness.transfer().status, "pending_current_owner");
  assert.equal(harness.audits.length, 0);
});

function releaseInput() {
  return { version: 1, reason: "Administrative release", outcome: "released" as const };
}

function assignedInput() {
  return {
    version: 1,
    reason: "Administrative assignment",
    outcome: "assigned" as const,
    responsibleUserId: TARGET_ID,
  };
}

function pendingTransfer(): TransferRecord {
  return {
    id: TRANSFER_ID,
    itemId: ITEM_ID,
    requestedBy: TARGET_ID,
    requestedByName: "Requester",
    proposedResponsibleId: TARGET_ID,
    currentResponsibleIdAtRequest: OWNER_ID,
    currentResponsibleName: "Owner",
    status: "pending_current_owner",
    requestedAt: new Date("2026-08-13T07:00:00.000Z"),
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

function authorizationUser(
  id: string,
  role: InventoryResponsibilityAuthorizationUser["role"],
  version: number,
  overrides: Partial<InventoryResponsibilityAuthorizationUser> = {},
): InventoryResponsibilityAuthorizationUser {
  return { id, role, active: true, deletedAt: null, version, ...overrides };
}

function hiddenTransfer(error: unknown) {
  return applicationError(error, "not_found", "transfer_not_found");
}

function applicationError(
  error: unknown,
  kind: ApplicationError["kind"],
  publicCode: string,
) {
  return error instanceof ApplicationError && error.kind === kind && error.publicCode === publicCode;
}
