import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";

import { ACTOR, RECIPIENT_ID, SNAPSHOT_OWNER_ID, NOW, createHarness, candidate, user, operationUser, requestRecord, requestItem, uuid } from "./support/tmc-transfer-request-harness";

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
test("detail and photo reads reject a revoked or demoted session before object lookup", async () => {
  const harness = createHarness();
  harness.repository.aggregate = requestRecord([candidate(uuid(1))]);
  harness.repository.photo = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
  harness.repository.users.set(
    ACTOR.userId,
    user({ id: ACTOR.userId, role: "employee", version: ACTOR.sessionVersion + 1 }),
  );

  const hiddenNotFound = (error: unknown) =>
    error instanceof ApplicationError &&
    error.kind === "not_found" &&
    error.publicCode === "request_not_found";
  await assert.rejects(
    harness.service.getById(harness.repository.aggregate.id, ACTOR),
    hiddenNotFound,
  );
  await assert.rejects(
    harness.service.getItemPhoto(
      harness.repository.aggregate.id,
      harness.repository.aggregate.items[0]!.itemId,
      ACTOR,
    ),
    hiddenNotFound,
  );
  assert.equal(harness.repository.findByIdCalls, 0);
  assert.deepEqual(harness.repository.photoCalls, []);
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
  assert.equal(scoped.initiator.email, null);
  assert.equal(scoped.recipient.email, null);
  assert.equal(scoped.closedBy?.email, null);
  assert.equal(scoped.items[0]?.responsibleUserProfile?.email, null);
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
