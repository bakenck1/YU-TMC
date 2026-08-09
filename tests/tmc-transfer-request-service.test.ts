import assert from "node:assert/strict";
import test from "node:test";

import type {
  InsertTmcTransferRequestItemRecord,
  InsertTmcTransferRequestRecord,
  InsertedTmcTransferRequestItemRecord,
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
const NOW = new Date("2026-08-09T12:00:00.000Z");

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

test("derives terminal state, complete summary, and overdue at the exact deadline", async () => {
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
  assert.equal(result.request?.overdue, true);
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
  private depth = 0;
  constructor(private readonly repository: TmcTransferRequestRepository) {}
  read<Result>(work: (repositories: TmcOperationRepositories) => Promise<Result>) {
    return work({ transferRequests: this.repository });
  }
  async transaction<Result>(work: (repositories: TmcOperationRepositories) => Promise<Result>) {
    const outer = this.depth === 0;
    if (outer) this.transactions += 1;
    const memory = this.repository as MemoryRequestRepository;
    const requestCount = memory.insertedRequests.length;
    const itemCount = memory.insertedItems.length;
    const resultCount = memory.insertedItemResults.length;
    this.depth += 1;
    try {
      return await work({ transferRequests: this.repository });
    } catch (error) {
      if (outer) {
        memory.insertedRequests.length = requestCount;
        memory.insertedItems.length = itemCount;
        memory.insertedItemResults.length = resultCount;
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
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
  async findById() {
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
        id: this.insertedItemResults.find(
          (inserted) => inserted.itemId === item.itemId,
        )?.id ?? item.id,
      })),
    };
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
