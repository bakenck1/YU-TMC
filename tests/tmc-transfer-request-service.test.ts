import assert from "node:assert/strict";
import test from "node:test";

import type {
  IdempotencyRequestInput,
  IdempotencyReservation,
  IdempotencyResponse,
} from "../lib/application/ports/inventory-concurrency-repositories";
import type {
  InsertTmcTransferRequestItemRecord,
  InsertTmcTransferRequestRecord,
  InsertedTmcTransferRequestItemRecord,
  DecideTmcTransferRequestItemRecord,
  CloseTmcTransferRequestRecord,
  CancelTmcTransferRequestRecord,
  TmcOperationRepositories,
  TmcTransferCandidateRecord,
  TmcTransferRequestRecord,
  TmcTransferRequestRepository,
  TmcTransferUserRecord,
} from "../lib/application/ports/tmc-operation-repositories";
import { TmcOperationRepositoryConflictError } from "../lib/application/ports/tmc-operation-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { TmcTransferRequestService } from "../lib/application/services/tmc-transfer-request-service";
import { ApplicationError } from "../lib/domain/application-error";

const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "employee" as const,
};
const RECIPIENT_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_OWNER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-09T12:00:00.000Z");
const IDEMPOTENCY_KEY = "tmc-create-000001";

test("participants and admin can read a request while BOLA is hidden as not found", async () => {
  const harness = createHarness();
  harness.repository.aggregate = requestRecord([
    candidate(uuid(1), { responsibleUser: user({ id: SNAPSHOT_OWNER_ID }) }),
  ]);
  for (const actor of [
    ACTOR,
    { userId: RECIPIENT_ID, role: "employee" as const },
    { userId: SNAPSHOT_OWNER_ID, role: "employee" as const },
    { userId: uuid(70), role: "admin" as const },
  ]) {
    assert.equal((await harness.service.getById(harness.repository.aggregate.id, actor)).id, harness.repository.aggregate.id);
  }
  await assert.rejects(
    harness.service.getById(harness.repository.aggregate.id, { userId: uuid(71), role: "employee" }),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found" && error.publicCode === "request_not_found",
  );
  const calls = harness.repository.findByIdCalls;
  await assert.rejects(
    harness.service.getById("invalid", ACTOR),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );
  assert.equal(harness.repository.findByIdCalls, calls);
});

test("snapshot-only readers cannot see sibling items owned by other users", async () => {
  const firstOwner = user({
    id: SNAPSHOT_OWNER_ID,
    fullName: "First Owner",
    email: "first-owner@example.test",
  });
  const secondOwner = user({
    id: uuid(72),
    fullName: "Second Owner Secret",
    email: "second-owner-secret@example.test",
  });
  const firstItem = candidate(uuid(1), { responsibleUser: firstOwner });
  const secondItem = candidate(uuid(2), {
    name: "Foreign sibling secret",
    inventoryNumber: "FOREIGN-SECRET-2",
    responsibleUser: secondOwner,
  });
  const harness = createHarness();
  harness.repository.aggregate = requestRecord([firstItem, secondItem]);

  const scoped = await harness.service.getById(
    harness.repository.aggregate.id,
    { userId: firstOwner.id, role: "employee" },
  );

  assert.deepEqual(scoped.items.map((item) => item.item.id), [firstItem.itemId]);
  assert.deepEqual(scoped.summary, {
    total: 1,
    pending: 1,
    accepted: 0,
    rejected: 0,
    cancelled: 0,
    invalidated: 0,
  });
  const serialized = JSON.stringify(scoped);
  for (const foreignValue of [
    secondItem.itemId,
    secondItem.name,
    secondItem.inventoryNumber,
    secondOwner.id,
    secondOwner.fullName,
    secondOwner.email,
  ]) {
    assert.equal(serialized.includes(foreignValue), false, foreignValue);
  }

  for (const actor of [
    ACTOR,
    { userId: RECIPIENT_ID, role: "employee" as const },
    { userId: uuid(70), role: "admin" as const },
  ]) {
    const complete = await harness.service.getById(
      harness.repository.aggregate.id,
      actor,
    );
    assert.deepEqual(
      complete.items.map((item) => item.item.id),
      [firstItem.itemId, secondItem.itemId],
    );
  }
});

test("snapshot-only readers cannot infer sibling outcomes from the parent status", async () => {
  const firstOwner = user({ id: SNAPSHOT_OWNER_ID });
  const secondOwner = user({ id: uuid(72) });
  const firstItem = candidate(uuid(1), { responsibleUser: firstOwner });
  const secondItem = candidate(uuid(2), { responsibleUser: secondOwner });

  for (const scenario of [
    {
      siblingResult: "accepted" as const,
      parent: {
        status: "accepted" as const,
        closedAt: NOW,
        closedBy: operationUser(RECIPIENT_ID),
      },
    },
    {
      siblingResult: "pending" as const,
      parent: {
        status: "pending" as const,
        closedAt: null,
        closedBy: null,
      },
    },
  ]) {
    const harness = createHarness();
    harness.repository.aggregate = requestRecord([firstItem, secondItem], {
      ...scenario.parent,
      items: [
        requestItem(firstItem, "rejected"),
        requestItem(secondItem, scenario.siblingResult),
      ],
    });

    const scoped = await harness.service.getById(
      harness.repository.aggregate.id,
      { userId: firstOwner.id, role: "employee" },
    );
    assert.equal(scoped.status, "rejected");
    assert.equal(scoped.summary.rejected, 1);
    assert.deepEqual(
      scoped.items.map((item) => item.item.id),
      [firstItem.itemId],
    );

    for (const actor of [
      ACTOR,
      { userId: RECIPIENT_ID, role: "employee" as const },
      { userId: uuid(70), role: "admin" as const },
    ]) {
      const complete = await harness.service.getById(
        harness.repository.aggregate.id,
        actor,
      );
      assert.equal(complete.status, scenario.parent.status);
      assert.equal(complete.items.length, 2);
    }
  }
});

test("participant-scoped view of a cancelled request resolves without throwing (regression for incompleteProjection on cancelled items)", async () => {
  // Regression: when a request is cancelled, pending items move to "cancelled"
  // without a decidedAt timestamp in the real database. The old code attempted
  // to read decidedAt from the item and threw incompleteProjection(). The fix
  // uses request.closedAt/closedBy from the parent record instead.
  const participant = user({ id: SNAPSHOT_OWNER_ID });
  const participantItem = candidate(uuid(1), { responsibleUser: participant });
  const sibling = candidate(uuid(2), { responsibleUser: user({ id: uuid(72) }) });

  const cancelledAt = new Date("2026-08-10T08:00:00.000Z");
  const cancelledBy = operationUser(ACTOR.userId);

  const harness = createHarness();
  harness.repository.aggregate = requestRecord([participantItem, sibling], {
    status: "cancelled",
    closedAt: cancelledAt,
    closedBy: cancelledBy,
    items: [
      // decidedAt is null on cancelled items — the real cancelRequest leaves it null
      // for items that were still pending at cancellation time.
      { ...requestItem(participantItem, "cancelled"), decidedAt: null, decidedBy: null },
      { ...requestItem(sibling, "cancelled"), decidedAt: null, decidedBy: null },
    ],
  });

  // Participant view must resolve without throwing.
  const scoped = await harness.service.getById(
    harness.repository.aggregate.id,
    { userId: participant.id, role: "employee" },
  );

  assert.equal(scoped.status, "cancelled");
  assert.equal(scoped.closedAt, cancelledAt.toISOString());
  assert.equal(scoped.closedBy?.id, cancelledBy.id);
  // Participant only sees their own item.
  assert.deepEqual(scoped.items.map((item) => item.item.id), [participantItem.itemId]);
  assert.deepEqual(scoped.summary, {
    total: 1,
    pending: 0,
    accepted: 0,
    rejected: 0,
    cancelled: 1,
    invalidated: 0,
  });
});

test("request-scoped photo access requires a participant and item membership", async () => {
  const harness = createHarness();
  const itemId = uuid(1);
  const hiddenNotFound = (error: unknown) =>
    error instanceof ApplicationError &&
    error.kind === "not_found" &&
    error.publicCode === "request_not_found";
  harness.repository.aggregate = requestRecord([
    candidate(itemId, { responsibleUser: user({ id: SNAPSHOT_OWNER_ID }) }),
  ]);
  harness.repository.photo = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
  for (const actor of [
    ACTOR,
    { userId: RECIPIENT_ID, role: "employee" as const },
    { userId: SNAPSHOT_OWNER_ID, role: "employee" as const },
    { userId: uuid(70), role: "admin" as const },
  ]) {
    assert.deepEqual(await harness.service.getItemPhoto(harness.repository.aggregate.id, itemId, actor), harness.repository.photo);
  }
  assert.equal(harness.repository.photoCalls.length, 4);
  await assert.rejects(
    harness.service.getItemPhoto(harness.repository.aggregate.id, itemId, { userId: uuid(71), role: "employee" }),
    hiddenNotFound,
  );
  assert.equal(harness.repository.photoCalls.length, 4);
  await assert.rejects(
    harness.service.getItemPhoto(harness.repository.aggregate.id, uuid(99), ACTOR),
    hiddenNotFound,
  );
  assert.equal(harness.repository.photoCalls.length, 4);
  harness.repository.photo = null;
  await assert.rejects(
    harness.service.getItemPhoto(harness.repository.aggregate.id, itemId, ACTOR),
    hiddenNotFound,
  );
  const calls = harness.repository.findByIdCalls;
  for (const [requestId, requestedItemId] of [
    ["invalid", itemId],
    [harness.repository.aggregate.id, "invalid"],
  ]) {
    await assert.rejects(
      harness.service.getItemPhoto(requestId, requestedItemId, ACTOR),
      hiddenNotFound,
    );
  }
  assert.equal(harness.repository.findByIdCalls, calls);
});

test("snapshot-only request participants cannot fetch a sibling owner's photo", async () => {
  const harness = createHarness();
  const ownedItemId = uuid(1);
  const siblingItemId = uuid(2);
  harness.repository.aggregate = requestRecord([
    candidate(ownedItemId, {
      responsibleUser: user({ id: SNAPSHOT_OWNER_ID }),
    }),
    candidate(siblingItemId, {
      responsibleUser: user({ id: uuid(72) }),
    }),
  ]);
  harness.repository.photo = {
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/jpeg",
  };

  await assert.doesNotReject(
    harness.service.getItemPhoto(
      harness.repository.aggregate.id,
      ownedItemId,
      { userId: SNAPSHOT_OWNER_ID, role: "employee" },
    ),
  );
  await assert.rejects(
    harness.service.getItemPhoto(
      harness.repository.aggregate.id,
      siblingItemId,
      { userId: SNAPSHOT_OWNER_ID, role: "employee" },
    ),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "not_found" &&
      error.publicCode === "request_not_found",
  );
  assert.deepEqual(harness.repository.photoCalls, [
    [harness.repository.aggregate.id, ownedItemId],
  ]);
});

test("creation writes immutable request/item audit and schedules direct plus overdue notifications atomically", async () => {
  const itemId = uuid(1);
  const harness = createHarness({ candidates: [candidate(itemId)] });
  await harness.service.create({ recipientId: RECIPIENT_ID, itemIds: [itemId] }, ACTOR);

  assert.equal(harness.unitOfWork.stageFour.audits.length, 2);
  const [requestAudit, itemAudit] = harness.unitOfWork.stageFour.audits as Array<{
    afterValues: Record<string, unknown>;
  }>;
  assert.equal(requestAudit?.afterValues.comment, null);
  assert.deepEqual(itemAudit?.afterValues, {
    requestId: "90000000-0000-4000-8000-000000000001",
    requestItemId: "90000000-0000-4000-8000-000000000002",
    recipientId: RECIPIENT_ID,
  });
  assert.deepEqual(
    harness.unitOfWork.stageFour.notifications.map((entry) => (entry as { type: string }).type),
    ["tmc_transfer.requested", "tmc_transfer.overdue"],
  );
});

test("initiator can cancel a pending request while unrelated users receive hidden not-found", async () => {
  const other = user({ id: uuid(73) });
  const harness = createHarness({ actors: [other] });
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);

  await assert.rejects(
    harness.service.cancel(harness.repository.aggregate.id, { requestVersion: 1 }, { userId: other.id, role: "employee" }),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );
  const cancelled = await harness.service.cancel(
    harness.repository.aggregate.id,
    { requestVersion: 1 },
    ACTOR,
  );
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.items.every((item) => item.result === "cancelled"));
  assert.equal(harness.unitOfWork.stageFour.audits.length, 2);
  assert.equal((harness.unitOfWork.stageFour.notifications[0] as { type: string }).type, "tmc_transfer.cancelled");
});

test("cancellation replays idempotently without duplicate audit or notifications", async () => {
  const harness = createHarness();
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  const first = await harness.service.cancelIdempotent(
    harness.repository.aggregate.id, { requestVersion: 1 }, ACTOR, "tmc-cancel-000001",
  );
  const replay = await harness.service.cancelIdempotent(
    harness.repository.aggregate.id, { requestVersion: 1 }, ACTOR, "tmc-cancel-000001",
  );
  assert.equal(first.kind, "completed");
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.body, first.body);
  assert.equal(harness.unitOfWork.stageFour.notifications.length, 1);
  assert.equal(harness.unitOfWork.stageFour.audits.length, 2);
});

test("administrator cancellation of another user's request requires a reason", async () => {
  const administrator = user({ id: uuid(74), role: "admin" });
  const harness = createHarness({ actors: [administrator] });
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  await assert.rejects(
    harness.service.cancel(harness.repository.aggregate.id, { requestVersion: 1 }, { userId: administrator.id, role: "admin" }),
    (error: unknown) => error instanceof ApplicationError && error.publicCode === "administrative_reason_required",
  );
  const cancelled = await harness.service.cancel(
    harness.repository.aggregate.id,
    { requestVersion: 1, administrativeReason: "Emergency handover" },
    { userId: administrator.id, role: "admin" },
  );
  assert.equal(cancelled.administrativeReason, "Emergency handover");
  const audits = harness.unitOfWork.stageFour.audits as Array<{
    afterValues: Record<string, unknown>;
  }>;
  assert.equal(audits[0]?.afterValues.administrativeReason, "Emergency handover");
  assert.equal(audits[1]?.afterValues.requestId, harness.repository.aggregate.id);
  assert.equal(audits[1]?.afterValues.requestItemId, harness.repository.aggregate.items[0]?.id);
  assert.deepEqual(
    (harness.unitOfWork.stageFour.notifications as Array<{ recipientId?: string }>).map((entry) => entry.recipientId).sort(),
    [ACTOR.userId, RECIPIENT_ID].sort(),
  );
});

test("cancellation audits only positions that actually transition from pending", async () => {
  const first = candidate(uuid(1));
  const second = candidate(uuid(2));
  const harness = createHarness();
  harness.repository.aggregate = requestRecord([first, second], {
    items: [requestItem(first, "pending"), requestItem(second, "rejected")],
  });

  await harness.service.cancel(harness.repository.aggregate.id, { requestVersion: 1 }, ACTOR);

  const itemAudits = (harness.unitOfWork.stageFour.audits as Array<{
    action: string;
    afterValues: Record<string, unknown>;
  }>).filter((entry) => entry.action === "tmc_transfer.item_cancelled");
  assert.equal(itemAudits.length, 1);
  assert.equal(itemAudits[0]?.afterValues.requestItemId, harness.repository.aggregate.items[0]?.id);
});

test("recipient accepts selected pending items and rejects every unchecked item atomically", async () => {
  const itemIds = [uuid(1), uuid(2), uuid(3)];
  const harness = createHarness();
  harness.repository.aggregate = requestRecord(itemIds.map((id) => candidate(id)));
  const result = await harness.service.decide(
    harness.repository.aggregate.id,
    {
      requestVersion: 1,
      decisions: harness.repository.aggregate.items.map((item, index) => ({
        itemId: item.itemId,
        itemVersion: item.version,
        decision: index < 2 ? "accept" as const : "reject" as const,
      })),
    },
    { userId: RECIPIENT_ID, role: "employee" },
  );
  assert.deepEqual(result.summary, {
    total: 3, pending: 0, accepted: 2, rejected: 1, cancelled: 0, invalidated: 0,
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(harness.repository.decisionCalls.map((call) => call.decision), ["accept", "accept", "reject"]);
});

test("recipient can accept an administrator request for an initially unassigned item", async () => {
  const item = candidate(uuid(1));
  const harness = createHarness();
  const aggregate = requestRecord([item]);
  Object.assign(aggregate.items[0]!, {
    responsibilityPeriodIdAtRequest: null,
    currentResponsibleIdAtRequest: null,
    responsibleUserProfile: null,
  });
  harness.repository.aggregate = aggregate;

  const result = await harness.service.decide(
    aggregate.id,
    {
      requestVersion: 1,
      decisions: [{ itemId: item.itemId, itemVersion: 1, decision: "accept" }],
    },
    { userId: RECIPIENT_ID, role: "employee" },
  );

  assert.equal(result.items[0]?.result, "accepted");
  assert.equal(harness.repository.decisionCalls[0]?.responsibilityPeriodIdAtRequest, null);
  assert.equal(harness.repository.decisionCalls[0]?.currentResponsibleIdAtRequest, null);
});

test("decision requires exact pending coverage and an admin override reason", async () => {
  const harness = createHarness({ actors: [user({ id: uuid(70), role: "admin" })] });
  harness.repository.aggregate = requestRecord([candidate(uuid(1)), candidate(uuid(2))]);
  await assert.rejects(
    harness.service.decide(
      harness.repository.aggregate.id,
      { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" }] },
      { userId: RECIPIENT_ID, role: "employee" },
    ),
    (error: unknown) => error instanceof ApplicationError && error.publicCode === "decision_coverage_mismatch",
  );
  await assert.rejects(
    harness.service.decide(
      harness.repository.aggregate.id,
      { requestVersion: 1, decisions: harness.repository.aggregate.items.map((item) => ({ itemId: item.itemId, itemVersion: item.version, decision: "accept" })) },
      { userId: uuid(70), role: "admin" },
    ),
    (error: unknown) => error instanceof ApplicationError && error.publicCode === "administrative_reason_required",
  );
  assert.equal(harness.repository.decisionCalls.length, 0);
});

test("decision hides an unavailable recipient from a non-participant", async () => {
  const outsider = user({ id: uuid(71) });
  const harness = createHarness({
    recipient: user({ active: false }),
    actors: [outsider],
  });
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  await assert.rejects(
    harness.service.decide(
      harness.repository.aggregate.id,
      { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" }] },
      { userId: outsider.id, role: "employee" },
    ),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );
  assert.equal(harness.repository.decisionCalls.length, 0);
});

test("decision uses the current database role and persists an administrator reason", async () => {
  const administrator = user({ id: uuid(70), role: "admin" });
  const harness = createHarness({ actors: [administrator] });
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  const result = await harness.service.decide(
    harness.repository.aggregate.id,
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" }], administrativeReason: "  Проверено  " },
    { userId: administrator.id, role: "employee" },
  );
  assert.equal(result.isAdministrativeDecision, true);
  assert.equal(result.administrativeReason, "Проверено");

  const staleSessionAdmin = createHarness({ actors: [user({ id: uuid(72), role: "employee" })] });
  staleSessionAdmin.repository.aggregate = requestRecord([candidate(uuid(2))]);
  await assert.rejects(
    staleSessionAdmin.service.decide(
      staleSessionAdmin.repository.aggregate.id,
      { requestVersion: 1, decisions: [{ itemId: uuid(2), itemVersion: 1, decision: "accept" }], administrativeReason: "override" },
      { userId: uuid(72), role: "admin" },
    ),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );
});

test("decision rejects NUL reasons and all client version conflicts before writes", async () => {
  const administrator = user({ id: uuid(70), role: "admin" });
  for (const input of [
    { requestVersion: 2, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "reason" },
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 2, decision: "accept" as const }], administrativeReason: "reason" },
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "bad\u0000reason" },
  ]) {
    const harness = createHarness({ actors: [administrator] });
    harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
    await assert.rejects(harness.service.decide(harness.repository.aggregate.id, input, { userId: administrator.id, role: "admin" }));
    assert.equal(harness.repository.decisionCalls.length, 0);
  }
});

test("decision records invalidated outcomes and rolls back an earlier item on a late conflict", async () => {
  const harness = createHarness();
  harness.repository.aggregate = requestRecord([candidate(uuid(1)), candidate(uuid(2))]);
  harness.repository.decisionResults.set(uuid(1), "invalidated");
  const input = {
    requestVersion: 1,
    decisions: harness.repository.aggregate.items.map((item) => ({ itemId: item.itemId, itemVersion: item.version, decision: "accept" as const })),
  };
  const invalidated = await harness.service.decide(harness.repository.aggregate.id, input, { userId: RECIPIENT_ID, role: "employee" });
  assert.deepEqual(invalidated.summary, { total: 2, pending: 0, accepted: 1, rejected: 0, cancelled: 0, invalidated: 1 });

  const rollback = createHarness();
  rollback.repository.aggregate = requestRecord([candidate(uuid(1)), candidate(uuid(2))]);
  rollback.repository.decisionFailureItemId = uuid(2);
  await assert.rejects(
    rollback.service.decide(rollback.repository.aggregate.id, input, { userId: RECIPIENT_ID, role: "employee" }),
    /version_conflict/,
  );
  assert.equal(rollback.repository.aggregate.items[0]?.result, "pending");
  assert.equal(rollback.repository.aggregate.status, "pending");
});

test("decision replays idempotently without applying responsibility twice", async () => {
  const harness = createHarness();
  harness.repository.aggregate = requestRecord([candidate(uuid(1)), candidate(uuid(2))]);
  const input = {
    requestVersion: 1,
    decisions: harness.repository.aggregate.items.map((item) => ({
      itemId: item.itemId,
      itemVersion: item.version,
      decision: "accept" as const,
    })),
  };
  const first = await harness.service.decideIdempotent(
    harness.repository.aggregate.id,
    input,
    { userId: RECIPIENT_ID, role: "employee" },
    "tmc-decision-000001",
  );
  const replay = await harness.service.decideIdempotent(
    harness.repository.aggregate.id,
    { ...input, decisions: [...input.decisions].reverse() },
    { userId: RECIPIENT_ID, role: "employee" },
    "tmc-decision-000001",
  );
  assert.equal(first.kind, "completed");
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.request, first.request);
  assert.equal(harness.repository.decisionCalls.length, 2);
});

test("decision replay reauthorizes the current database role and rejects changed payload", async () => {
  const administrator = user({ id: uuid(70), role: "admin" });
  const harness = createHarness({ actors: [administrator] });
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  const input = { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "reason" };
  await harness.service.decideIdempotent(harness.repository.aggregate.id, input, { userId: administrator.id, role: "admin" }, "tmc-decision-admin-1");
  harness.repository.users.set(administrator.id, { ...administrator, role: "employee" });
  await assert.rejects(
    harness.service.decideIdempotent(harness.repository.aggregate.id, input, { userId: administrator.id, role: "admin" }, "tmc-decision-admin-1"),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );

  const recipientHarness = createHarness();
  recipientHarness.repository.aggregate = requestRecord([candidate(uuid(2))]);
  const recipientInput = { requestVersion: 1, decisions: [{ itemId: uuid(2), itemVersion: 1, decision: "accept" as const }] };
  await recipientHarness.service.decideIdempotent(recipientHarness.repository.aggregate.id, recipientInput, { userId: RECIPIENT_ID, role: "employee" }, "tmc-decision-recipient-1");
  await assert.rejects(
    recipientHarness.service.decideIdempotent(recipientHarness.repository.aggregate.id, { ...recipientInput, decisions: [{ ...recipientInput.decisions[0]!, decision: "reject" }] }, { userId: RECIPIENT_ID, role: "employee" }, "tmc-decision-recipient-1"),
    (error: unknown) => error instanceof ApplicationError && error.publicCode === "idempotency_key_reused",
  );
});

test("replays the exact TMC create result without a second mutation", async () => {
  const itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const harness = createHarness({ candidates: [candidate(itemId)] });

  const first = await harness.service.createIdempotent(
    {
      recipientId: RECIPIENT_ID.toUpperCase(),
      itemIds: [itemId.toUpperCase()],
      comment: "  Ａ transfer  ",
    },
    ACTOR,
    IDEMPOTENCY_KEY,
  );
  const second = await harness.service.createIdempotent(
    {
      recipientId: RECIPIENT_ID,
      itemIds: [itemId],
      comment: "A transfer",
    },
    ACTOR,
    IDEMPOTENCY_KEY,
  );

  assert.equal(first.kind, "completed");
  assert.equal(first.status, 201);
  assert.equal(first.resourceId, first.result.request?.id);
  assert.equal(second.kind, "replayed");
  assert.deepEqual(second, { ...first, kind: "replayed" });
  assert.equal(harness.repository.insertedRequests.length, 1);
  assert.equal(harness.repository.insertedItems.length, 1);
});

test("rejects reuse of a TMC idempotency key for a different payload", async () => {
  const itemIds = [uuid(1), uuid(2)];
  const harness = createHarness({ candidates: itemIds.map((id) => candidate(id)) });

  await harness.service.createIdempotent(
    { recipientId: RECIPIENT_ID, itemIds },
    ACTOR,
    IDEMPOTENCY_KEY,
  );
  await assert.rejects(
    harness.service.createIdempotent(
      { recipientId: RECIPIENT_ID, itemIds: [...itemIds].reverse() },
      ACTOR,
      IDEMPOTENCY_KEY,
    ),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "conflict" &&
      error.publicCode === "idempotency_key_reused",
  );
  assert.equal(harness.repository.insertedRequests.length, 1);
});

test("replays an all-problem result without creating a parent", async () => {
  const itemId = uuid(1);
  const harness = createHarness({
    candidates: [candidate(itemId, { responsibleUser: null })],
  });

  const first = await harness.service.createIdempotent(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    ACTOR,
    IDEMPOTENCY_KEY,
  );
  const second = await harness.service.createIdempotent(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    ACTOR,
    IDEMPOTENCY_KEY,
  );

  assert.equal(first.result.request, null);
  assert.deepEqual(second, {
    body: { result: first.result },
    kind: "replayed",
    result: first.result,
    status: 200,
  });
  assert.equal(harness.repository.insertedRequests.length, 0);
});

test("rejects invalid TMC idempotency keys before a transaction", async () => {
  for (const key of [undefined, "short", "x".repeat(129), "invalid key"] as const) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.createIdempotent(
        { recipientId: RECIPIENT_ID, itemIds: [uuid(1)] },
        ACTOR,
        key as never,
      ),
      (error: unknown) =>
        error instanceof ApplicationError && error.kind === "validation",
    );
    assert.equal(harness.unitOfWork.transactions, 0);
  }
});

test("rolls back the TMC mutation when idempotency completion fails", async () => {
  const itemId = uuid(1);
  const harness = createHarness({ candidates: [candidate(itemId)] });
  harness.unitOfWork.idempotency.failNextCompletion = true;

  await assert.rejects(
    harness.service.createIdempotent(
      { recipientId: RECIPIENT_ID, itemIds: [itemId] },
      ACTOR,
      IDEMPOTENCY_KEY,
    ),
    /injected_idempotency_completion_failure/,
  );
  assert.equal(harness.repository.insertedRequests.length, 0);
  assert.equal(harness.repository.insertedItems.length, 0);

  const retried = await harness.service.createIdempotent(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    ACTOR,
    IDEMPOTENCY_KEY,
  );
  assert.equal(retried.kind, "completed");
  assert.equal(harness.repository.insertedRequests.length, 1);
});

test("rejects a corrupted persisted TMC replay response", async () => {
  const itemId = uuid(1);
  const harness = createHarness({ candidates: [candidate(itemId)] });
  await harness.service.createIdempotent(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    ACTOR,
    IDEMPOTENCY_KEY,
  );
  harness.unitOfWork.idempotency.corruptCompletedResponse({
    body: { result: { total: "not-a-number" } },
    status: 201,
  });

  await assert.rejects(
    harness.service.createIdempotent(
      { recipientId: RECIPIENT_ID, itemIds: [itemId] },
      ACTOR,
      IDEMPOTENCY_KEY,
    ),
    /tmc_idempotency_response_invalid/,
  );
});

test("replays an all-late-conflict result without retrying item inserts", async () => {
  const itemIds = [uuid(1), uuid(2)];
  const harness = createHarness({ candidates: itemIds.map((id) => candidate(id)) });
  for (const itemId of itemIds) {
    harness.repository.failures.set(
      itemId,
      new TmcOperationRepositoryConflictError(
        "responsibility_changed",
        new Error("late conflict"),
      ),
    );
  }

  const first = await harness.service.createIdempotent(
    { recipientId: RECIPIENT_ID, itemIds },
    ACTOR,
    IDEMPOTENCY_KEY,
  );
  const insertCalls = harness.repository.calls.filter(
    (call) => call === "insertRequestItem",
  ).length;
  const replay = await harness.service.createIdempotent(
    { recipientId: RECIPIENT_ID, itemIds },
    ACTOR,
    IDEMPOTENCY_KEY,
  );

  assert.equal(first.result.request, null);
  assert.equal(replay.kind, "replayed");
  assert.equal(harness.repository.insertedRequests.length, 0);
  assert.equal(
    harness.repository.calls.filter((call) => call === "insertRequestItem").length,
    insertCalls,
  );
});

test("rejects an unknown runtime role before repository access", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.create(
      { recipientId: RECIPIENT_ID, itemIds: [uuid(1)] },
      { userId: ACTOR.userId, role: "unexpected" } as never,
    ),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "forbidden" &&
      error.publicCode === "forbidden",
  );

  assert.equal(harness.unitOfWork.transactions, 0);
  assert.deepEqual(harness.repository.calls, []);
  assert.equal(harness.ids.created, 0);
});

test("allows a warehouse user to transfer an item they currently own", async () => {
  const itemId = uuid(1);
  const warehouse = { userId: ACTOR.userId, role: "warehouse" as const };
  const harness = createHarness({
    actors: [user({ id: warehouse.userId, role: warehouse.role })],
    candidates: [candidate(itemId)],
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    warehouse,
  );

  assert.equal(result.included, 1);
  assert.equal(harness.repository.insertedRequests[0]?.initiatorId, warehouse.userId);
});

test("uses the current database role instead of a stale admin actor", async () => {
  const staleAdmin = { userId: uuid(70), role: "admin" as const };
  const itemId = uuid(1);
  const harness = createHarness({
    actors: [user({ id: staleAdmin.userId, role: "employee" })],
    candidates: [candidate(itemId, {
      responsibleUser: user({ id: uuid(77) }),
    })],
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    staleAdmin,
  );

  assert.equal(result.request, null);
  assert.deepEqual(result.items, [{
    itemId,
    outcome: "problem",
    problem: "forbidden",
  }]);
});

test("rejects an inactive or deleted current actor inside the transaction", async () => {
  for (const actorRecord of [
    user({ id: ACTOR.userId, active: false }),
    user({ id: ACTOR.userId, deletedAt: NOW }),
  ]) {
    const harness = createHarness({
      actors: [actorRecord],
      candidates: [candidate(uuid(1))],
    });

    await assert.rejects(
      harness.service.create(
        { recipientId: RECIPIENT_ID, itemIds: [uuid(1)] },
        ACTOR,
      ),
      (error: unknown) =>
        error instanceof ApplicationError && error.kind === "forbidden",
    );
    assert.equal(harness.unitOfWork.transactions, 1);
    assert.equal(harness.repository.calls.includes("findCandidates"), false);
    assert.equal(harness.ids.created, 0);
  }
});

test("applies employee ownership per item without revealing foreign state", async () => {
  const itemIds = [uuid(1), uuid(2), uuid(3)];
  const ownCandidates = [candidate(itemIds[0]!), candidate(itemIds[2]!)];
  const harness = createHarness({
    candidates: [
      ownCandidates[0]!,
      candidate(itemIds[1]!, {
        itemStatus: "maintenance",
        hasActiveTransfer: true,
        responsibleUser: user({ id: uuid(77) }),
      }),
      ownCandidates[1]!,
    ],
  });
  harness.repository.aggregate = requestRecord(ownCandidates);

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds },
    ACTOR,
  );

  assert.deepEqual(
    result.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome),
    ["included", "forbidden", "included"],
  );
  assert.deepEqual(
    harness.repository.insertedItems.map((item) => item.itemId),
    [itemIds[0], itemIds[2]],
  );
});

test("does not persist a parent for an all-foreign employee batch", async () => {
  const itemIds = [uuid(1), uuid(2)];
  const harness = createHarness({
    candidates: itemIds.map((itemId) =>
      candidate(itemId, { responsibleUser: user({ id: uuid(77) }) })),
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds },
    ACTOR,
  );

  assert.equal(result.request, null);
  assert.deepEqual(
    result.items.map((item) =>
      item.outcome === "problem" ? item.problem : item.outcome),
    ["forbidden", "forbidden"],
  );
  assert.equal(harness.repository.insertedRequests.length, 0);
  assert.equal(harness.repository.insertedItems.length, 0);
});

test("allows an administrator to group items from different owners", async () => {
  const admin = { userId: uuid(70), role: "admin" as const };
  const itemIds = [uuid(1), uuid(2)];
  const candidates = itemIds.map((itemId, index) =>
    candidate(itemId, {
      responsibilityPeriodId: uuid(90 + index),
      responsibleUser: user({ id: uuid(75 + index) }),
    }));
  const harness = createHarness({
    actors: [user({ id: admin.userId, role: admin.role })],
    candidates,
  });
  harness.repository.aggregate = requestRecord(candidates);

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds },
    admin,
  );

  assert.equal(result.included, 2);
  assert.deepEqual(
    harness.repository.insertedItems.map((item) =>
      item.currentResponsibleIdAtRequest),
    [uuid(75), uuid(76)],
  );
  assert.equal(harness.repository.insertedRequests[0]?.initiatorId, admin.userId);
});

test("allows an administrator to request assignment of an unassigned active item", async () => {
  const admin = { userId: uuid(70), role: "admin" as const };
  const itemId = uuid(1);
  const unassigned = candidate(itemId, {
    responsibilityPeriodId: null,
    responsibleUser: null,
  });
  const harness = createHarness({
    actors: [user({ id: admin.userId, role: admin.role })],
    candidates: [unassigned],
  });
  const aggregate = requestRecord([candidate(itemId)]);
  Object.assign(aggregate.items[0]!, {
    responsibilityPeriodIdAtRequest: null,
    currentResponsibleIdAtRequest: null,
    responsibleUserProfile: null,
  });
  harness.repository.aggregate = aggregate;

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    admin,
  );

  assert.equal(result.included, 1);
  assert.equal(result.request?.items[0]?.currentResponsibleIdAtRequest, null);
  assert.equal(result.request?.items[0]?.responsibleUserProfile, null);
  assert.equal(harness.repository.insertedItems[0]?.responsibilityPeriodIdAtRequest, null);
  assert.equal(harness.repository.insertedItems[0]?.currentResponsibleIdAtRequest, null);
});

test("does not let an administrator transfer an item to its current owner", async () => {
  const itemId = uuid(1);
  const harness = createHarness({
    actors: [user({ id: uuid(70), role: "admin" })],
    candidates: [candidate(itemId, {
      responsibleUser: user({ id: RECIPIENT_ID }),
    })],
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    { userId: uuid(70), role: "admin" },
  );

  assert.equal(result.request, null);
  assert.deepEqual(result.items, [{
    itemId,
    outcome: "problem",
    problem: "already_responsible",
  }]);
  assert.equal(harness.repository.insertedRequests.length, 0);
});

test("rejects malformed create input before repository access", async () => {
  const invalidInputs = [
    { recipientId: "not-a-uuid", itemIds: [uuid(1)] },
    { recipientId: RECIPIENT_ID, itemIds: [] },
    { recipientId: RECIPIENT_ID, itemIds: "not-an-array" },
    { recipientId: RECIPIENT_ID, itemIds: ["not-a-uuid"] },
    {
      recipientId: RECIPIENT_ID,
      itemIds: Array.from({ length: 51 }, (_, index) => uuid(index + 1)),
    },
    { recipientId: RECIPIENT_ID, itemIds: [uuid(1)], comment: "x".repeat(1_001) },
    { recipientId: RECIPIENT_ID, itemIds: [uuid(1)], comment: "invalid\u0000comment" },
  ];

  for (const input of invalidInputs) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.create(input as never, ACTOR),
      (error: unknown) =>
        error instanceof ApplicationError && error.kind === "validation",
    );
    assert.equal(harness.repository.calls.length, 0);
    assert.equal(harness.ids.created, 0);
  }
});

test("canonicalizes UUIDs and detects duplicates across letter case", async () => {
  const itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const harness = createHarness({ candidates: [candidate(itemId)] });

  const result = await harness.service.create(
    {
      recipientId: RECIPIENT_ID.toUpperCase(),
      itemIds: [itemId.toUpperCase(), itemId],
    },
    ACTOR,
  );

  assert.deepEqual(
    harness.repository.requestedRecipientIds,
    [ACTOR.userId, RECIPIENT_ID],
  );
  assert.deepEqual(harness.repository.requestedCandidateIds, [[itemId, itemId]]);
  assert.deepEqual(result.items, [
    {
      itemId,
      outcome: "included",
      requestItemId: "90000000-0000-4000-8000-000000000002",
      requestItemVersion: 1,
    },
    { itemId, outcome: "problem", problem: "duplicate_item" },
  ]);
});

test("normalizes optional comments and rejects unavailable recipients", async () => {
  const unavailableUsers: Array<TmcTransferUserRecord | null> = [
    null,
    user({ active: false }),
    user({ deletedAt: new Date("2026-08-09T11:00:00.000Z") }),
    user({ id: ACTOR.userId }),
  ];
  for (const recipient of unavailableUsers) {
    const harness = createHarness({ recipient });
    await assert.rejects(
      harness.service.create({ recipientId: recipient?.id ?? RECIPIENT_ID, itemIds: [uuid(1)] }, ACTOR),
      ApplicationError,
    );
    assert.equal(harness.repository.insertedRequests.length, 0);
  }

  const harness = createHarness({ candidates: [candidate(uuid(1))] });
  await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [uuid(1)], comment: "  Ａ передача  " },
    ACTOR,
  );
  assert.equal(harness.repository.insertedRequests[0]?.comment, "A передача");

  for (const comment of [undefined, null, "", "   "] as const) {
    const emptyHarness = createHarness({ candidates: [candidate(uuid(1))] });
    await emptyHarness.service.create(
      { recipientId: RECIPIENT_ID, itemIds: [uuid(1)], comment },
      ACTOR,
    );
    assert.equal(emptyHarness.repository.insertedRequests[0]?.comment, null);
  }
});

test("classifies a mixed batch with deterministic precedence and input order", async () => {
  const ids = Array.from({ length: 7 }, (_, index) => uuid(index + 1));
  const valid = candidate(ids[0]!);
  const harness = createHarness({
    candidates: [
      candidate(ids[5]!, { responsibleUser: user({ id: RECIPIENT_ID }) }),
      candidate(ids[2]!, { itemStatus: "maintenance" }),
      candidate(ids[0]!),
      candidate(ids[4]!, {
        itemStatus: "maintenance",
        responsibilityPeriodId: null,
        responsibleUser: null,
      }),
      candidate(ids[3]!, { archivedAt: NOW }),
      candidate(ids[6]!, { hasActiveTransfer: true }),
    ],
  });
  harness.repository.aggregate = requestRecord([valid]);

  const result = await harness.service.create(
    {
      recipientId: RECIPIENT_ID,
      itemIds: [ids[0]!, ids[1]!, ids[2]!, ids[3]!, ids[4]!, ids[5]!, ids[6]!, ids[0]!],
    },
    ACTOR,
  );

  assert.equal(result.total, 8);
  assert.equal(result.included, 1);
  assert.equal(result.problems, 7);
  assert.deepEqual(
    result.items.map((item) =>
      item.outcome === "problem" ? [item.itemId, item.problem] : [item.itemId, item.outcome]
    ),
    [
      [ids[0], "included"],
      [ids[1], "item_not_found"],
      [ids[2], "item_inactive"],
      [ids[3], "item_inactive"],
      [ids[4], "forbidden"],
      [ids[5], "forbidden"],
      [ids[6], "active_transfer_exists"],
      [ids[0], "duplicate_item"],
    ],
  );
  assert.equal(harness.repository.insertedItems.length, 1);
});

test("does not create a parent when every item is problematic", async () => {
  const itemId = uuid(1);
  const harness = createHarness({
    candidates: [candidate(itemId, { itemStatus: "decommissioned" })],
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [itemId, uuid(2)] },
    ACTOR,
  );

  assert.deepEqual(result, {
    request: null,
    total: 2,
    included: 0,
    problems: 2,
    items: [
      { itemId, outcome: "problem", problem: "item_inactive" },
      { itemId: uuid(2), outcome: "problem", problem: "item_not_found" },
    ],
  });
  assert.equal(harness.repository.insertedRequests.length, 0);
  assert.equal(harness.repository.insertedItems.length, 0);
  assert.equal(harness.repository.findByIdCalls, 0);
  assert.equal(harness.ids.created, 0);
});

test("creates one parent, snapshots included items, and hydrates persisted DTO", async () => {
  const itemIds = [uuid(1), uuid(2)];
  const candidates = itemIds.map((itemId) => candidate(itemId));
  const harness = createHarness({ candidates });
  harness.repository.aggregate = requestRecord(candidates, {
    id: "90000000-0000-4000-8000-000000000001",
    comment: "Передача",
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds, comment: " Передача " },
    ACTOR,
  );

  assert.equal(harness.unitOfWork.transactions, 1);
  assert.deepEqual(harness.repository.insertedRequests, [{
    id: "90000000-0000-4000-8000-000000000001",
    initiatorId: ACTOR.userId,
    recipientId: RECIPIENT_ID,
    comment: "Передача",
    createdAt: NOW,
    expiresAt: new Date("2026-08-10T12:00:00.000Z"),
  }]);
  assert.deepEqual(
    harness.repository.insertedItems.map((item) => ({
      requestId: item.requestId,
      itemId: item.itemId,
      expectedVersion: item.expectedItemVersion,
      period: item.responsibilityPeriodIdAtRequest,
      responsible: item.currentResponsibleIdAtRequest,
      createdAt: item.createdAt,
    })),
    candidates.map((item) => ({
      requestId: "90000000-0000-4000-8000-000000000001",
      itemId: item.itemId,
      expectedVersion: item.itemVersion,
      period: item.responsibilityPeriodId,
      responsible: item.responsibleUser?.id,
      createdAt: NOW,
    })),
  );
  assert.equal(result.request?.createdAt, NOW.toISOString());
  assert.equal(result.request?.expiresAt, "2026-08-10T12:00:00.000Z");
  assert.equal(result.request?.overdue, false);
  assert.deepEqual(result.request?.summary, {
    total: 2,
    pending: 2,
    accepted: 0,
    rejected: 0,
    cancelled: 0,
    invalidated: 0,
  });
  assert.deepEqual(
    result.items.map((item) => item.outcome === "included" && item.requestItemVersion),
    [1, 1],
  );
});

test("derives terminal state and complete summary without marking a closed request overdue", async () => {
  const results = ["pending", "accepted", "rejected", "cancelled", "invalidated"] as const;
  const candidates = results.map((_, index) => candidate(uuid(index + 1)));
  const harness = createHarness({ candidates, now: new Date("2026-08-10T12:00:00.000Z") });
  harness.repository.aggregate = requestRecord(candidates, {
    status: "accepted",
    expiresAt: new Date("2026-08-10T12:00:00.000Z"),
    closedAt: new Date("2026-08-10T11:00:00.000Z"),
    closedBy: operationUser(ACTOR.userId),
    items: results.map((result, index) => requestItem(candidates[index]!, result)),
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: candidates.map(({ itemId }) => itemId) },
    ACTOR,
  );

  assert.equal(result.request?.status, "accepted");
  assert.equal(result.request?.overdue, false);
  assert.deepEqual(result.request?.summary, {
    total: 5,
    pending: 1,
    accepted: 1,
    rejected: 1,
    cancelled: 1,
    invalidated: 1,
  });
  assert.equal(result.request?.items[1]?.decidedAt, NOW.toISOString());
  assert.equal(result.request?.items[4]?.invalidReason, "responsibility_changed");
});

test("marks a pending request overdue at the exact deadline", async () => {
  const item = candidate(uuid(1));
  const harness = createHarness({
    candidates: [item],
    now: new Date("2026-08-10T12:00:00.000Z"),
  });
  harness.repository.aggregate = requestRecord([item], {
    expiresAt: new Date("2026-08-10T12:00:00.000Z"),
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [item.itemId] },
    ACTOR,
  );

  assert.equal(result.request?.status, "pending");
  assert.equal(result.request?.overdue, true);
});

test("computes overdue using the time after the persisted aggregate is read", async () => {
  const itemId = uuid(1);
  const afterExpiry = new Date("2026-08-10T12:00:00.001Z");
  const harness = createHarness({
    candidates: [candidate(itemId)],
    times: [NOW, afterExpiry],
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    ACTOR,
  );

  assert.equal(harness.repository.insertedRequests[0]?.createdAt, NOW);
  assert.equal(result.request?.overdue, true);
  assert.equal(harness.clockCalls(), 2);
});

test("fails closed when the persisted aggregate is missing or incomplete", async () => {
  const itemId = uuid(1);
  for (const aggregate of [null, requestRecord([])]) {
    const harness = createHarness({ candidates: [candidate(itemId)] });
    harness.repository.aggregate = aggregate;
    await assert.rejects(
      harness.service.create({ recipientId: RECIPIENT_ID, itemIds: [itemId] }, ACTOR),
      /tmc_transfer_request_projection_incomplete/,
    );
  }
});

test("continues after known late item conflicts and preserves outcome order", async () => {
  const itemIds = [uuid(1), uuid(2), uuid(3)];
  const harness = createHarness({ candidates: itemIds.map((id) => candidate(id)) });
  harness.repository.failures.set(
    itemIds[1]!,
    new TmcOperationRepositoryConflictError("active_transfer_exists", new Error("late conflict")),
  );

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds },
    ACTOR,
  );

  assert.equal(result.request?.items.length, 2);
  assert.deepEqual(result.items.map((item) =>
    item.outcome === "problem" ? item.problem : item.outcome), [
    "included",
    "active_transfer_exists",
    "included",
  ]);
  assert.deepEqual(
    harness.repository.insertedItems.map(({ itemId }) => itemId),
    [itemIds[0], itemIds[2]],
  );
});

test("rolls back an empty parent when every included item conflicts late", async () => {
  const itemIds = [uuid(1), uuid(2)];
  const harness = createHarness({ candidates: itemIds.map((id) => candidate(id)) });
  for (const itemId of itemIds) {
    harness.repository.failures.set(
      itemId,
      new TmcOperationRepositoryConflictError("responsibility_changed", new Error("late conflict")),
    );
  }

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds },
    ACTOR,
  );

  assert.equal(result.request, null);
  assert.equal(result.included, 0);
  assert.deepEqual(result.items.map((item) =>
    item.outcome === "problem" ? item.problem : item.outcome), [
    "responsibility_changed",
    "responsibility_changed",
  ]);
  assert.equal(harness.repository.insertedRequests.length, 0);
  assert.equal(harness.repository.insertedItems.length, 0);
});

function createHarness(options: {
  recipient?: TmcTransferUserRecord | null;
  actors?: TmcTransferUserRecord[];
  candidates?: TmcTransferCandidateRecord[];
  now?: Date;
  times?: Date[];
} = {}) {
  const repository = new MemoryRequestRepository();
  repository.recipient = options.recipient === undefined ? user() : options.recipient;
  if (repository.recipient) {
    repository.users.set(repository.recipient.id, repository.recipient);
  }
  repository.users.set(ACTOR.userId, user({ id: ACTOR.userId }));
  for (const actor of options.actors ?? []) {
    repository.users.set(actor.id, actor);
  }
  repository.candidates = options.candidates ?? [];
  const unitOfWork = new MemoryUnitOfWork(repository);
  const ids = {
    created: 0,
    create() {
      this.created += 1;
      return `90000000-0000-4000-8000-${String(this.created).padStart(12, "0")}`;
    },
  };
  const times = [...(options.times ?? [options.now ?? NOW])];
  let clockCalls = 0;
  const clock = {
    now() {
      const value = times[Math.min(clockCalls, times.length - 1)]!;
      clockCalls += 1;
      return value;
    },
  };
  return {
    repository,
    unitOfWork,
    ids,
    clockCalls: () => clockCalls,
    service: new TmcTransferRequestService(unitOfWork, clock, ids),
  };
}

class MemoryUnitOfWork implements UnitOfWork<TmcOperationRepositories> {
  transactions = 0;
  readonly idempotency = new MemoryIdempotencyRepository();
  private depth = 0;
  readonly stageFour = {
    audits: [] as unknown[],
    notifications: [] as unknown[],
    async listHistory() { return []; },
    async listLocationHistory() { return []; },
    async appendAudit(input: unknown) { this.audits.push(input); },
    async createNotification(input: unknown) { this.notifications.push(input); },
    async listNotifications() { return []; },
    async countUnreadNotifications() { return 0; },
    async markNotificationRead() { return false; },
  };
  constructor(private readonly repository: TmcTransferRequestRepository) {}
  read<Result>(work: (repositories: TmcOperationRepositories) => Promise<Result>) {
    return work({
      idempotency: this.idempotency,
      transferRequests: this.repository,
      stageFour: this.stageFour,
    });
  }
  async transaction<Result>(work: (repositories: TmcOperationRepositories) => Promise<Result>) {
    const outer = this.depth === 0;
    if (outer) this.transactions += 1;
    const memory = this.repository as MemoryRequestRepository;
    const requestCount = memory.insertedRequests.length;
    const itemCount = memory.insertedItems.length;
    const resultCount = memory.insertedItemResults.length;
    const decisionCount = memory.decisionCalls.length;
    const aggregateSnapshot = structuredClone(memory.aggregate);
    const idempotencySnapshot = this.idempotency.snapshot();
    this.depth += 1;
    try {
      return await work({
        idempotency: this.idempotency,
        transferRequests: this.repository,
        stageFour: this.stageFour,
      });
    } catch (error) {
      memory.insertedRequests.length = requestCount;
      memory.insertedItems.length = itemCount;
      memory.insertedItemResults.length = resultCount;
      memory.decisionCalls.length = decisionCount;
      memory.aggregate = aggregateSnapshot;
      this.idempotency.restore(idempotencySnapshot);
      throw error;
    } finally {
      this.depth -= 1;
    }
  }
}

interface MemoryIdempotencyRecord {
  id: string;
  requestHash: string;
  response: IdempotencyResponse | null;
  state: "processing" | "completed";
}

class MemoryIdempotencyRepository {
  failNextCompletion = false;
  private records = new Map<string, MemoryIdempotencyRecord>();

  async reserve(input: IdempotencyRequestInput): Promise<IdempotencyReservation> {
    const scope = `${input.actorId}\u0000${input.operation}\u0000${input.key}`;
    const existing = this.records.get(scope);
    if (!existing) {
      this.records.set(scope, {
        id: input.id,
        requestHash: input.requestHash,
        response: null,
        state: "processing",
      });
      return { kind: "reserved", id: input.id };
    }
    if (existing.requestHash !== input.requestHash) {
      return { kind: "key_reused" };
    }
    if (existing.state === "processing") return { kind: "in_progress" };
    return {
      kind: "replay",
      response: structuredClone(existing.response!),
    };
  }

  async complete(id: string, response: IdempotencyResponse) {
    const record = [...this.records.values()].find((value) => value.id === id);
    if (!record || record.state !== "processing") {
      throw new ApplicationError("conflict", "idempotency_request_not_processing");
    }
    record.state = "completed";
    record.response = structuredClone(response);
    if (this.failNextCompletion) {
      this.failNextCompletion = false;
      throw new Error("injected_idempotency_completion_failure");
    }
  }

  snapshot() {
    return structuredClone(this.records);
  }

  restore(snapshot: Map<string, MemoryIdempotencyRecord>) {
    this.records = snapshot;
  }

  corruptCompletedResponse(response: IdempotencyResponse) {
    const record = [...this.records.values()].find(
      (value) => value.state === "completed",
    );
    if (!record) throw new Error("missing_completed_idempotency_record");
    record.response = structuredClone(response);
  }
}

class MemoryRequestRepository implements TmcTransferRequestRepository {
  recipient: TmcTransferUserRecord | null = user();
  candidates: TmcTransferCandidateRecord[] = [];
  aggregate: TmcTransferRequestRecord | null | undefined;
  calls: string[] = [];
  insertedRequests: InsertTmcTransferRequestRecord[] = [];
  insertedItems: InsertTmcTransferRequestItemRecord[] = [];
  insertedItemResults: InsertedTmcTransferRequestItemRecord[] = [];
  findByIdCalls = 0;
  requestedRecipientIds: string[] = [];
  requestedCandidateIds: string[][] = [];
  failures = new Map<string, TmcOperationRepositoryConflictError>();
  users = new Map<string, TmcTransferUserRecord>();
  photo: { bytes: Uint8Array; mimeType: "image/jpeg" } | null = null;
  photoCalls: string[][] = [];
  decisionCalls: DecideTmcTransferRequestItemRecord[] = [];
  decisionResults = new Map<string, "accepted" | "rejected" | "invalidated">();
  decisionFailureItemId: string | null = null;

  async findUserById(id: string) {
    this.calls.push("findUserById");
    this.requestedRecipientIds.push(id);
    return this.users.get(id) ?? null;
  }
  async findCandidates(itemIds: readonly string[]) {
    this.calls.push("findCandidates");
    this.requestedCandidateIds.push([...itemIds]);
    return this.candidates;
  }
  async findById(_id?: string) {
    this.calls.push("findById");
    this.findByIdCalls += 1;
    const aggregate = this.aggregate !== undefined ? this.aggregate : (
      this.insertedItems.length > 0
        ? requestRecord(
            this.insertedItems.map((item) => candidate(item.itemId)),
            { id: this.insertedRequests[0]!.id, comment: this.insertedRequests[0]!.comment },
          )
        : null
    );
    if (!aggregate) return null;
    return {
      ...aggregate,
      items: aggregate.items.map((item) => ({
        ...item,
        requestId: aggregate.id,
        id: this.insertedItemResults.find(
          (inserted) => inserted.itemId === item.itemId,
        )?.id ?? item.id,
      })),
    };
  }
  async findByIdForUpdate(id: string) {
    return this.findById(id);
  }
  async findItemPhoto(requestId: string, itemId: string) {
    this.photoCalls.push([requestId, itemId]);
    return this.photo;
  }
  async decideItem(input: DecideTmcTransferRequestItemRecord) {
    this.decisionCalls.push(input);
    if (input.itemId === this.decisionFailureItemId) {
      throw new ApplicationError("conflict", "version_conflict");
    }
    const item = this.aggregate?.items.find((candidate) => candidate.id === input.requestItemId);
    if (!item || item.result !== "pending" || item.version !== input.expectedVersion) {
      throw new ApplicationError("conflict", "version_conflict");
    }
    const result = this.decisionResults.get(input.itemId) ?? (input.decision === "accept" ? "accepted" as const : "rejected" as const);
    Object.assign(item, {
      result,
      invalidReason: result === "invalidated" ? "responsibility_changed" : null,
      decidedAt: input.decidedAt,
      decidedBy: operationUser(input.decidedBy),
      version: item.version + 1,
    });
    return result;
  }
  async closeRequest(input: CloseTmcTransferRequestRecord) {
    if (!this.aggregate || this.aggregate.version !== input.expectedVersion) return false;
    Object.assign(this.aggregate, {
      status: input.status,
      closedAt: input.closedAt,
      closedBy: operationUser(input.closedBy),
      isAdministrativeDecision: input.isAdministrativeDecision,
      administrativeReason: input.administrativeReason,
      version: this.aggregate.version + 1,
    });
    return true;
  }
  async cancelRequest(input: CancelTmcTransferRequestRecord) {
    if (!this.aggregate || this.aggregate.version !== input.expectedVersion || this.aggregate.status !== "pending") return false;
    for (const item of this.aggregate.items) {
      if (item.result === "pending") Object.assign(item, {
        result: "cancelled", decidedAt: input.cancelledAt,
        decidedBy: operationUser(input.cancelledBy), version: item.version + 1,
      });
    }
    Object.assign(this.aggregate, {
      status: "cancelled", closedAt: input.cancelledAt,
      closedBy: operationUser(input.cancelledBy),
      isAdministrativeDecision: input.isAdministrativeDecision,
      administrativeReason: input.administrativeReason,
      version: this.aggregate.version + 1,
    });
    return true;
  }
  async insertRequest(input: InsertTmcTransferRequestRecord) {
    this.calls.push("insertRequest");
    this.insertedRequests.push(input);
  }
  async insertRequestItem(input: InsertTmcTransferRequestItemRecord) {
    this.calls.push("insertRequestItem");
    const failure = this.failures.get(input.itemId);
    if (failure) throw failure;
    this.insertedItems.push(input);
    const result: InsertedTmcTransferRequestItemRecord = {
      ...input,
      result: "pending",
      invalidReason: null,
      decidedAt: null,
      decidedBy: null,
      version: 1,
    };
    this.insertedItemResults.push(result);
    return result;
  }
}

function candidate(
  itemId: string,
  overrides: Partial<TmcTransferCandidateRecord> = {},
): TmcTransferCandidateRecord {
  return {
    itemId,
    itemVersion: 1,
    itemStatus: "active",
    archivedAt: null,
    name: `Item ${itemId}`,
    inventoryNumber: `INV-${itemId}`,
    quantity: 1,
    unitPrice: 100,
    photoUrl: null,
    buildingId: uuid(80),
    buildingName: "Building",
    roomId: uuid(81),
    roomDesignation: "101",
    responsibilityPeriodId: uuid(90),
    responsibleUser: user({ id: ACTOR.userId }),
    hasActiveTransfer: false,
    ...overrides,
  };
}

function user(overrides: Partial<TmcTransferUserRecord> = {}): TmcTransferUserRecord {
  return {
    ...operationUser(RECIPIENT_ID),
    active: true,
    deletedAt: null,
    ...overrides,
  };
}

function operationUser(id: string) {
  return { id, fullName: `User ${id}`, email: `${id}@example.com`, role: "employee" as const };
}

function requestRecord(
  candidates: TmcTransferCandidateRecord[],
  overrides: Partial<TmcTransferRequestRecord> = {},
): TmcTransferRequestRecord {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    initiator: operationUser(ACTOR.userId),
    recipient: operationUser(RECIPIENT_ID),
    status: "pending",
    comment: null,
    createdAt: NOW,
    expiresAt: new Date("2026-08-10T12:00:00.000Z"),
    closedAt: null,
    closedBy: null,
    isAdministrativeDecision: false,
    administrativeReason: null,
    version: 1,
    items: candidates.map((item) => requestItem(item, "pending")),
    ...overrides,
  };
}

function requestItem(
  candidateRecord: TmcTransferCandidateRecord,
  result: "pending" | "accepted" | "rejected" | "cancelled" | "invalidated",
) {
  const terminal = result !== "pending";
  return {
    id: `80000000-0000-4000-8000-${candidateRecord.itemId.slice(-12)}`,
    requestId: "90000000-0000-4000-8000-000000000001",
    itemId: candidateRecord.itemId,
    item: {
      id: candidateRecord.itemId,
      version: candidateRecord.itemVersion,
      name: candidateRecord.name,
      inventoryNumber: candidateRecord.inventoryNumber,
      quantity: candidateRecord.quantity,
      unitPrice: candidateRecord.unitPrice,
      photoUrl: candidateRecord.photoUrl,
      buildingId: candidateRecord.buildingId,
      buildingName: candidateRecord.buildingName,
      roomId: candidateRecord.roomId,
      roomDesignation: candidateRecord.roomDesignation,
    },
    responsibilityPeriodIdAtRequest: candidateRecord.responsibilityPeriodId!,
    currentResponsibleIdAtRequest: candidateRecord.responsibleUser!.id,
    responsibleUserProfile: candidateRecord.responsibleUser!,
    result,
    invalidReason: result === "invalidated" ? "responsibility_changed" : null,
    createdAt: NOW,
    decidedAt: terminal ? NOW : null,
    decidedBy: terminal ? operationUser(RECIPIENT_ID) : null,
    version: terminal ? 2 : 1,
  };
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
