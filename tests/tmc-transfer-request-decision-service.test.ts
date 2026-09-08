import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";

import { RECIPIENT_ID, createHarness, candidate, user, requestRecord, uuid } from "./support/tmc-transfer-request-harness";

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
    { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 },
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
    { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 },
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
      { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 },
    ),
    (error: unknown) => error instanceof ApplicationError && error.publicCode === "decision_coverage_mismatch",
  );
  await assert.rejects(
    harness.service.decide(
      harness.repository.aggregate.id,
      { requestVersion: 1, decisions: harness.repository.aggregate.items.map((item) => ({ itemId: item.itemId, itemVersion: item.version, decision: "accept" })) },
      { userId: uuid(70), role: "admin", sessionVersion: 1 },
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
      { userId: outsider.id, role: "employee", sessionVersion: 1 },
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
    { userId: administrator.id, role: "employee", sessionVersion: 1 },
  );
  assert.equal(result.isAdministrativeDecision, true);
  assert.equal(result.administrativeReason, "Проверено");
  assert.equal(
    harness.repository.decisionCalls[0]?.responsibilitySource,
    "admin_override",
  );
  const decisionAudits = harness.unitOfWork.stageFour.audits as Array<{
    action: string;
    reason?: string | null;
    isAdministrativeException?: boolean;
  }>;
  assert.equal(decisionAudits.length, 2);
  for (const audit of decisionAudits) {
    assert.equal(audit.reason, result.administrativeReason);
    assert.equal(audit.isAdministrativeException, true);
  }

  const staleSessionAdmin = createHarness({ actors: [user({ id: uuid(72), role: "employee" })] });
  staleSessionAdmin.repository.aggregate = requestRecord([candidate(uuid(2))]);
  await assert.rejects(
    staleSessionAdmin.service.decide(
      staleSessionAdmin.repository.aggregate.id,
      { requestVersion: 1, decisions: [{ itemId: uuid(2), itemVersion: 1, decision: "accept" }], administrativeReason: "override" },
      { userId: uuid(72), role: "admin", sessionVersion: 1 },
    ),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );
});

test("decision binds transactional authorization to the authenticated session version", async () => {
  const harness = createHarness({ recipient: user({ version: 2 }) });
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  const input = {
    requestVersion: 1,
    decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }],
  };
  const staleSessionActor = {
    userId: RECIPIENT_ID,
    role: "employee" as const,
    sessionVersion: 1,
  };

  await assert.rejects(
    harness.service.decideIdempotent(
      harness.repository.aggregate.id,
      input,
      staleSessionActor,
      "tmc-session-version-1",
    ),
    (error: unknown) =>
      error instanceof ApplicationError && error.kind === "not_found",
  );
  assert.equal(harness.repository.decisionCalls.length, 0);

  const completed = await harness.service.decideIdempotent(
    harness.repository.aggregate.id,
    input,
    { ...staleSessionActor, sessionVersion: 2 },
    "tmc-session-version-1",
  );
  assert.equal(completed.kind, "completed");
});

test("decision rejects invisible administrative reasons and all client version conflicts before writes", async () => {
  const administrator = user({ id: uuid(70), role: "admin" });
  for (const input of [
    { requestVersion: 2, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "reason" },
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 2, decision: "accept" as const }], administrativeReason: "reason" },
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "bad\u0000reason" },
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "\u200B" },
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "\u202Ehidden" },
    { requestVersion: 1, decisions: [{ itemId: uuid(1), itemVersion: 1, decision: "accept" as const }], administrativeReason: "\u0301" },
  ]) {
    const harness = createHarness({ actors: [administrator] });
    harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
    await assert.rejects(harness.service.decide(harness.repository.aggregate.id, input, { userId: administrator.id, role: "admin", sessionVersion: 1 }));
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
  const invalidated = await harness.service.decide(harness.repository.aggregate.id, input, { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 });
  assert.deepEqual(invalidated.summary, { total: 2, pending: 0, accepted: 1, rejected: 0, cancelled: 0, invalidated: 1 });

  const rollback = createHarness();
  rollback.repository.aggregate = requestRecord([candidate(uuid(1)), candidate(uuid(2))]);
  rollback.repository.decisionFailureItemId = uuid(2);
  await assert.rejects(
    rollback.service.decide(rollback.repository.aggregate.id, input, { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 }),
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
    administrativeReason: "   ",
    decisions: harness.repository.aggregate.items.map((item) => ({
      itemId: item.itemId,
      itemVersion: item.version,
      decision: "accept" as const,
    })),
  };
  const first = await harness.service.decideIdempotent(
    harness.repository.aggregate.id,
    input,
    { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 },
    "tmc-decision-000001",
  );
  const replay = await harness.service.decideIdempotent(
    harness.repository.aggregate.id,
    {
      requestVersion: input.requestVersion,
      decisions: [...input.decisions].reverse().map((decision) => ({
        decision: decision.decision,
        itemVersion: decision.itemVersion,
        itemId: decision.itemId,
      })),
    },
    { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 },
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
  await harness.service.decideIdempotent(harness.repository.aggregate.id, input, { userId: administrator.id, role: "admin", sessionVersion: 1 }, "tmc-decision-admin-1");
  harness.repository.users.set(administrator.id, { ...administrator, role: "employee" });
  await assert.rejects(
    harness.service.decideIdempotent(harness.repository.aggregate.id, input, { userId: administrator.id, role: "admin", sessionVersion: 1 }, "tmc-decision-admin-1"),
    (error: unknown) => error instanceof ApplicationError && error.kind === "not_found",
  );

  const recipientHarness = createHarness();
  recipientHarness.repository.aggregate = requestRecord([candidate(uuid(2))]);
  const recipientInput = { requestVersion: 1, decisions: [{ itemId: uuid(2), itemVersion: 1, decision: "accept" as const }] };
  await recipientHarness.service.decideIdempotent(recipientHarness.repository.aggregate.id, recipientInput, { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 }, "tmc-decision-recipient-1");
  await assert.rejects(
    recipientHarness.service.decideIdempotent(recipientHarness.repository.aggregate.id, { ...recipientInput, decisions: [{ ...recipientInput.decisions[0]!, decision: "reject" }] }, { userId: RECIPIENT_ID, role: "employee", sessionVersion: 1 }, "tmc-decision-recipient-1"),
    (error: unknown) => error instanceof ApplicationError && error.publicCode === "idempotency_key_reused",
  );
});
