import assert from "node:assert/strict";
import test from "node:test";

import type { TmcTransferCandidateRecord, TmcTransferUserRecord } from "../lib/application/ports/tmc-operation-repositories";
import { TmcOperationRepositoryConflictError } from "../lib/application/ports/tmc-operation-repositories";
import { ApplicationError } from "../lib/domain/application-error";

import { ACTOR, RECIPIENT_ID, NOW, IDEMPOTENCY_KEY, createHarness, candidate, user, operationUser, requestRecord, requestItem, uuid } from "./support/tmc-transfer-request-harness";

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
    problem: "item_unavailable",
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
    ["included", "item_unavailable", "included"],
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
    ["item_unavailable", "item_unavailable"],
  );
  assert.equal(harness.repository.insertedRequests.length, 0);
  assert.equal(harness.repository.insertedItems.length, 0);
});

test("a scanned-item claim goes to the current owner and acceptance assigns the requester", async () => {
  const itemId = uuid(1);
  const currentOwner = user({ id: RECIPIENT_ID, fullName: "Current Owner" });
  const claimCandidate = candidate(itemId, {
    responsibleUser: currentOwner,
  });
  const harness = createHarness({ candidates: [claimCandidate] });
  harness.repository.aggregate = requestRecord([claimCandidate], {
    initiator: operationUser(ACTOR.userId),
    recipient: operationUser(currentOwner.id),
  });

  const created = await harness.service.create(
    {
      recipientId: currentOwner.id,
      itemIds: [itemId],
      requestKind: "claim",
    },
    ACTOR,
  );

  assert.equal(created.included, 1);
  assert.equal(created.request?.recipient.id, currentOwner.id);
  assert.equal(
    (harness.unitOfWork.stageFour.notifications[0] as { recipientId?: string })
      .recipientId,
    currentOwner.id,
  );

  const decided = await harness.service.decide(
    harness.repository.aggregate.id,
    {
      requestVersion: 1,
      decisions: [{ itemId, itemVersion: 1, decision: "accept" }],
    },
    {
      userId: currentOwner.id,
      role: "employee",
      sessionVersion: 1,
    },
  );

  assert.equal(decided.status, "accepted");
  assert.equal(harness.repository.decisionCalls[0]?.decidedBy, currentOwner.id);
  assert.equal(harness.repository.decisionCalls[0]?.recipientId, ACTOR.userId);
});

test("an administrator immediately assigns grouped items and notifies the new responsible user", async () => {
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
  harness.repository.aggregate = requestRecord(candidates, {
    initiator: operationUser(admin.userId, "admin"),
  });

  const result = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds },
    admin,
  );

  assert.equal(result.included, 2);
  assert.equal(result.request?.status, "accepted");
  assert.deepEqual(result.request?.summary, {
    total: 2,
    pending: 0,
    accepted: 2,
    rejected: 0,
    cancelled: 0,
    invalidated: 0,
  });
  assert.deepEqual(
    harness.repository.decisionCalls.map((call) => call.decision),
    ["accept", "accept"],
  );
  assert.deepEqual(
    harness.repository.decisionCalls.map((call) => call.responsibilitySource),
    ["admin_override", "admin_override"],
  );
  assert.deepEqual(
    harness.repository.insertedItems.map((item) =>
      item.currentResponsibleIdAtRequest),
    [uuid(75), uuid(76)],
  );
  assert.equal(harness.repository.insertedRequests[0]?.initiatorId, admin.userId);
  assert.equal(
    harness.unitOfWork.stageFour.notifications.some((entry) =>
      (entry as { type: string; recipientId?: string }).type === "tmc_transfer.completed" &&
      (entry as { recipientId?: string }).recipientId === RECIPIENT_ID),
    true,
  );
  assert.equal(
    harness.unitOfWork.stageFour.notifications.some((entry) =>
      (entry as { recipientId?: string }).recipientId === admin.userId),
    false,
  );
  assert.equal(
    harness.unitOfWork.stageFour.notifications.some((entry) =>
      (entry as { type: string }).type === "tmc_transfer.requested" ||
      (entry as { type: string }).type === "tmc_transfer.overdue"),
    false,
  );
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
  aggregate.initiator = operationUser(admin.userId, "admin");
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
  assert.equal(result.request?.status, "accepted");
  assert.equal(result.request?.items[0]?.result, "accepted");
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
  const recipientCases: Array<{
    recipient: TmcTransferUserRecord | null;
    recipientId: string;
    publicCode: string;
  }> = [
    { recipient: null, recipientId: RECIPIENT_ID, publicCode: "recipient_unavailable" },
    { recipient: user({ active: false }), recipientId: RECIPIENT_ID, publicCode: "recipient_unavailable" },
    {
      recipient: user({ deletedAt: new Date("2026-08-09T11:00:00.000Z") }),
      recipientId: RECIPIENT_ID,
      publicCode: "recipient_unavailable",
    },
    { recipient: user({ id: ACTOR.userId }), recipientId: ACTOR.userId, publicCode: "recipient_must_differ_from_initiator" },
  ];
  for (const { recipient, recipientId, publicCode } of recipientCases) {
    const harness = createHarness({ recipient });
    await assert.rejects(
      harness.service.create({ recipientId, itemIds: [uuid(1)] }, ACTOR),
      (error: unknown) =>
        error instanceof ApplicationError && error.publicCode === publicCode,
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

test("uses one neutral item outcome for missing, foreign, and inaccessible items", async () => {
  const itemId = uuid(1);
  const cases: Array<{
    candidates: TmcTransferCandidateRecord[];
    expected: "item_unavailable";
  }> = [
    { candidates: [], expected: "item_unavailable" },
    {
      candidates: [candidate(itemId, { responsibleUser: user({ id: uuid(77) }) })],
      expected: "item_unavailable",
    },
    {
      candidates: [candidate(itemId, {
        itemStatus: "maintenance",
        responsibleUser: user({ id: uuid(77) }),
      })],
      expected: "item_unavailable",
    },
  ];

  for (const { candidates, expected } of cases) {
    const harness = createHarness({ candidates });
    const result = await harness.service.create(
      { recipientId: RECIPIENT_ID, itemIds: [itemId] },
      ACTOR,
    );
    assert.deepEqual(result.items, [{
      itemId,
      outcome: "problem",
      problem: expected,
    }]);
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
      [ids[1], "item_unavailable"],
      [ids[2], "item_inactive"],
      [ids[3], "item_inactive"],
      [ids[4], "item_unavailable"],
      [ids[5], "item_unavailable"],
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
      { itemId: uuid(2), outcome: "problem", problem: "item_unavailable" },
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
