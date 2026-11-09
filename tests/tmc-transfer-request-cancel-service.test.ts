import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";

import { ACTOR, RECIPIENT_ID, createHarness, candidate, user, requestRecord, requestItem, uuid } from "./support/tmc-transfer-request-harness";

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

test("administrator cancellation of another user's request requires a reason", async () => {
  const administrator = user({ id: uuid(74), role: "admin" });
  const harness = createHarness({ actors: [administrator] });
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  await assert.rejects(
    harness.service.cancel(harness.repository.aggregate.id, { requestVersion: 1 }, {
      userId: administrator.id,
      role: "admin",
      sessionVersion: administrator.version,
    }),
    (error: unknown) => error instanceof ApplicationError && error.publicCode === "administrative_reason_required",
  );
  const cancelled = await harness.service.cancel(
    harness.repository.aggregate.id,
    { requestVersion: 1, administrativeReason: "  Emergency handover  " },
    { userId: administrator.id, role: "employee", sessionVersion: administrator.version },
  );
  assert.equal(cancelled.administrativeReason, "Emergency handover");
  const audits = harness.unitOfWork.stageFour.audits as Array<{
    afterValues: Record<string, unknown>;
    reason?: string | null;
    isAdministrativeException?: boolean;
  }>;
  assert.equal(audits[0]?.afterValues.administrativeReason, "Emergency handover");
  assert.equal(audits[1]?.afterValues.requestId, harness.repository.aggregate.id);
  assert.equal(audits[1]?.afterValues.requestItemId, harness.repository.aggregate.items[0]?.id);
  assert.equal(audits.every((entry) =>
    entry.reason === "Emergency handover" && entry.isAdministrativeException === true), true);
  assert.deepEqual(
    (harness.unitOfWork.stageFour.notifications as Array<{ recipientId?: string }>).map((entry) => entry.recipientId).sort(),
    [ACTOR.userId, RECIPIENT_ID].sort(),
  );
});

test("administrator cancellation rejects invisible audit reasons before mutation", async () => {
  const administrator = user({ id: uuid(74), role: "admin" });
  for (const administrativeReason of [
    "bad\u0000reason",
    "\u200B",
    "\u202Ehidden",
    "\u0301",
  ]) {
    const harness = createHarness({ actors: [administrator] });
    harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
    await assert.rejects(
      harness.service.cancel(
        harness.repository.aggregate.id,
        { requestVersion: 1, administrativeReason },
        {
          userId: administrator.id,
          role: "admin",
          sessionVersion: administrator.version,
        },
      ),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.publicCode === "invalid_administrative_reason",
    );
    assert.equal(harness.repository.aggregate.status, "pending");
    assert.equal(harness.unitOfWork.stageFour.audits.length, 0);
    assert.equal(harness.unitOfWork.stageFour.notifications.length, 0);
  }
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
