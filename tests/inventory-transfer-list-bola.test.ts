import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryResponsibilityRepository,
  TransferRecord,
} from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { ApplicationError } from "../lib/domain/application-error";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const TRANSFER_ID = "44444444-4444-4444-8444-444444444444";

test("a stale collection actor cannot read another user's transfers", async () => {
  let legacyCalls = 0;
  let authorizedCalls = 0;
  const service = createService({
    listTransfersForUser: async () => {
      legacyCalls += 1;
      return [transferFor(ACTOR_ID)];
    },
    listTransfersForAuthorizedUser: async () => {
      authorizedCalls += 1;
      return [];
    },
  });

  const transfers = await service.listTransfers({
    userId: ACTOR_ID,
    role: "employee",
    sessionVersion: 8,
  });

  assert.deepEqual(transfers, []);
  assert.equal(legacyCalls, 0);
  assert.equal(authorizedCalls, 1);
});

test("collection scope canonicalizes the actor and preserves incoming direction", async () => {
  const calls: unknown[] = [];
  const service = createService({
    listTransfersForUser: async () => {
      throw new Error("legacy_unscoped_lookup_must_not_run");
    },
    listTransfersForAuthorizedUser: async (input: unknown) => {
      calls.push(input);
      return [transferFor(ACTOR_ID)];
    },
  });

  const transfers = await service.listTransfers({
    userId: ACTOR_ID.toUpperCase(),
    role: "employee",
    sessionVersion: 7,
  });

  assert.deepEqual(calls, [{
    userId: ACTOR_ID,
    role: "employee",
    sessionVersion: 7,
  }]);
  assert.equal(transfers[0]?.direction, "incoming");
});

test("malformed collection actors fail closed before repository access", async () => {
  let calls = 0;
  const service = createService({
    listTransfersForUser: async () => {
      calls += 1;
      return [transferFor(ACTOR_ID)];
    },
    listTransfersForAuthorizedUser: async () => {
      calls += 1;
      return [transferFor(ACTOR_ID)];
    },
  });

  for (const actor of [
    { userId: "not-a-uuid", role: "employee" as const, sessionVersion: 7 },
    { userId: ACTOR_ID, role: "employee" as const, sessionVersion: 0 },
    { userId: ACTOR_ID, role: "employee" as const, sessionVersion: 1.5 },
  ]) {
    await assert.rejects(
      service.listTransfers(actor),
      (error) =>
        error instanceof ApplicationError &&
        error.kind === "not_found" &&
        error.publicCode === "transfers_not_found",
    );
  }
  assert.equal(calls, 0);
});

function createService(
  overrides: Record<string, unknown>,
) {
  const repository = overrides as unknown as InventoryResponsibilityRepository;
  const repositories = { responsibility: repository };
  const unitOfWork: UnitOfWork<typeof repositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryResponsibilityService(
    unitOfWork,
    { now: () => new Date("2026-08-13T08:00:00.000Z") },
    { create: () => "55555555-5555-4555-8555-555555555555" },
  );
}

function transferFor(currentResponsibleIdAtRequest: string): TransferRecord {
  return {
    id: TRANSFER_ID,
    itemId: ITEM_ID,
    itemName: "Laptop",
    itemInventoryNumber: "INV-1",
    requestedBy: OTHER_ID,
    requestedByName: "Requester",
    proposedResponsibleId: OTHER_ID,
    currentResponsibleIdAtRequest,
    currentResponsibleName: "Owner",
    status: "pending_current_owner",
    requestedAt: new Date("2026-08-13T07:00:00.000Z"),
    closedAt: null,
    decisionComment: null,
    version: 1,
  };
}
