import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import {
  TmcOperationRepositoryConflictError,
  type TmcTransferRequestRecord,
} from "../lib/application/ports/tmc-operation-repositories";
import { createPostgresTmcOperationRepositories } from "../lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

interface QueryCall {
  text: string;
  values: readonly unknown[] | undefined;
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

class QueryQueue {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly responses: Array<
      | { rows: unknown[]; rowCount?: number }
      | Error
    >,
  ) {}

  readonly query = async (
    text: string,
    values?: readonly unknown[],
  ) => {
    this.calls.push({ text, values });
    const response = this.responses.shift();
    if (!response) throw new Error("unexpected_query");
    if (response instanceof Error) throw response;
    return {
      command: "SELECT",
      fields: [],
      oid: 0,
      rowCount: response.rowCount ?? response.rows.length,
      rows: response.rows,
    };
  };

  asSource() {
    return { query: this.query } as unknown as PostgresRepositorySource;
  }
}

test("TMC repository ports and PostgreSQL adapter type-check together", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join("node_modules", "typescript", "bin", "tsc"),
      "--project",
      path.join(
        "tests",
        "typecheck",
        "tsconfig.tmc-operation-repositories.json",
      ),
      "--pretty",
      "false",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
});

test("findCandidates returns validation data without hiding problematic items", async () => {
  const archivedAt = new Date("2026-08-09T10:00:00.000Z");
  const source = new QueryQueue([
    {
      rows: [
        candidateRow({ has_active_transfer: false }),
        candidateRow({
          item_id: "22222222-2222-4222-8222-222222222222",
          item_status: "decommissioned",
          archived_at: archivedAt,
          responsibility_period_id: null,
          responsible_user_id: null,
          responsible_full_name: null,
          responsible_email: null,
          responsible_role: null,
          responsible_is_active: null,
          responsible_deleted_at: null,
          has_active_transfer: true,
        }),
        candidateRow({
          item_id: "33333333-3333-4333-8333-333333333333",
          has_active_transfer: true,
        }),
      ],
    },
  ]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;
  const requestedIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];

  const result = await repository.findCandidates(requestedIds);

  assert.equal(source.calls.length, 1);
  assert.deepEqual(source.calls[0]?.values, [requestedIds]);
  assert.match(source.calls[0]!.text, /any\(\$1::uuid\[\]\)/i);
  assert.match(source.calls[0]!.text, /pending_current_owner/);
  assert.match(source.calls[0]!.text, /request_item\.result = 'pending'/);
  assert.deepEqual(result[0], {
    itemId: "11111111-1111-4111-8111-111111111111",
    itemVersion: 7,
    itemStatus: "active",
    archivedAt: null,
    name: "Ноутбук",
    inventoryNumber: "INV-001",
    quantity: 2,
    unitPrice: 125000.5,
    photoUrl: "/api/inventory/items/11111111-1111-4111-8111-111111111111/photo?v=7",
    buildingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    buildingName: "Корпус A",
    roomId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    roomDesignation: "101",
    responsibilityPeriodId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    responsibleUser: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      fullName: "Текущий сотрудник",
      email: "owner@example.com",
      role: "employee",
      active: true,
      deletedAt: null,
    },
    hasActiveTransfer: false,
  });
  assert.equal(result[1]?.archivedAt?.toISOString(), archivedAt.toISOString());
  assert.equal(result[1]?.responsibleUser, null);
  assert.deepEqual(
    result.map(({ hasActiveTransfer }) => hasActiveTransfer),
    [false, true, true],
  );
});

test("findUserById returns active, inactive, and missing recipients", async () => {
  const deletedAt = new Date("2026-08-09T09:00:00.000Z");
  const source = new QueryQueue([
    { rows: [{
      id: "88888888-8888-4888-8888-888888888888",
      full_name: "Active Recipient",
      email: "active@example.com",
      role: "employee",
      is_active: true,
      deleted_at: null,
    }] },
    { rows: [{
      id: "77777777-7777-4777-8777-777777777777",
      full_name: "Inactive Recipient",
      email: "inactive@example.com",
      role: "warehouse",
      is_active: false,
      deleted_at: deletedAt,
    }] },
    { rows: [] },
  ]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;

  assert.deepEqual(
    await repository.findUserById("88888888-8888-4888-8888-888888888888"),
    {
      id: "88888888-8888-4888-8888-888888888888",
      fullName: "Active Recipient",
      email: "active@example.com",
      role: "employee",
      active: true,
      deletedAt: null,
    },
  );
  assert.deepEqual(
    await repository.findUserById("77777777-7777-4777-8777-777777777777"),
    {
      id: "77777777-7777-4777-8777-777777777777",
      fullName: "Inactive Recipient",
      email: "inactive@example.com",
      role: "warehouse",
      active: false,
      deletedAt,
    },
  );
  assert.equal(
    await repository.findUserById("66666666-6666-4666-8666-666666666666"),
    null,
  );
  assert.equal(source.calls.length, 3);
  assert.doesNotMatch(source.calls[0]!.text, /is_active\s*=\s*true/i);
  assert.match(source.calls[0]!.text, /for no key update/i);
});

test("findCandidates avoids SQL for an empty item set", async () => {
  const source = new QueryQueue([]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;

  await assert.doesNotReject(async () => {
    assert.deepEqual(await repository.findCandidates([]), []);
  });
  assert.equal(source.calls.length, 0);
});

test("insertRequest and insertRequestItem persist the responsibility snapshot", async () => {
  const createdAt = new Date("2026-08-09T11:00:00.000Z");
  const expiresAt = new Date("2026-08-10T11:00:00.000Z");
  const source = new QueryQueue([
    { rows: [], rowCount: 1 },
    {
      rows: [{
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        request_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        item_id: "11111111-1111-4111-8111-111111111111",
        responsibility_period_id_at_request:
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        current_responsible_id_at_request:
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        result: "pending",
        invalid_reason: null,
        created_at: createdAt,
        decided_at: null,
        decided_by: null,
        version: 1,
      }],
    },
  ]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;

  await repository.insertRequest({
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    initiatorId: "99999999-9999-4999-8999-999999999999",
    recipientId: "88888888-8888-4888-8888-888888888888",
    comment: null,
    createdAt,
    expiresAt,
  });
  const item = await repository.insertRequestItem({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    itemId: "11111111-1111-4111-8111-111111111111",
    expectedItemVersion: 7,
    responsibilityPeriodIdAtRequest:
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    currentResponsibleIdAtRequest:
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    createdAt,
  });

  assert.match(source.calls[0]!.text, /tmc_transfer_requests/);
  assert.deepEqual(source.calls[0]?.values, [
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "99999999-9999-4999-8999-999999999999",
    "88888888-8888-4888-8888-888888888888",
    null,
    createdAt,
    expiresAt,
  ]);
  assert.match(source.calls[1]!.text, /responsibility_period_id_at_request/);
  assert.deepEqual(source.calls[1]?.values, [
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "11111111-1111-4111-8111-111111111111",
    7,
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    createdAt,
  ]);
  assert.equal(item.result, "pending");
  assert.equal(item.version, 1);
});

test("insertRequestItem maps a failed atomic item-version check", async () => {
  const source = new QueryQueue([
    {
      rows: [{
        id: null,
        request_id: null,
        item_id: null,
        responsibility_period_id_at_request: null,
        current_responsible_id_at_request: null,
        result: null,
        invalid_reason: null,
        created_at: null,
        decided_at: null,
        decided_by: null,
        version: null,
        item_exists: true,
        item_status: "active",
        archived_at: null,
        item_version: "8",
        expected_period_open: true,
      }],
    },
  ]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;

  await assert.rejects(
    repository.insertRequestItem(insertItemInput()),
    (error) =>
      error instanceof TmcOperationRepositoryConflictError &&
      error.problem === "version_conflict",
  );
  assert.equal(source.calls.length, 1);
  assert.match(source.calls[0]!.text, /with locked_item[\s\S]+insert/i);
  assert.match(source.calls[0]!.text, /for update/i);
  assert.match(source.calls[0]!.text, /item\.version\s*=\s*\$4/i);
  assert.match(source.calls[0]!.text, /period\.ended_at\s+is\s+null/i);
});

test("insertRequestItem maps only known constraints to item problem codes", async () => {
  const constraints = [
    ["tmc_transfer_request_items_pending_item_unique", "active_transfer_exists"],
    ["tmc_active_item_transfer_unique", "active_transfer_exists"],
    ["tmc_transfer_request_items_period_snapshot_fk", "responsibility_changed"],
    ["tmc_transfer_request_items_request_item_unique", "duplicate_item"],
  ] as const;

  for (const [constraint, expectedProblem] of constraints) {
    const databaseError = Object.assign(new Error("constraint"), {
      code: constraint.includes("fk") ? "23503" : "23505",
      constraint,
    });
    const repository = createPostgresTmcOperationRepositories(
      new QueryQueue([databaseError]).asSource(),
    ).transferRequests;
    await assert.rejects(
      repository.insertRequestItem(insertItemInput()),
      (error) =>
        error instanceof TmcOperationRepositoryConflictError &&
        error.problem === expectedProblem &&
        error.cause === databaseError,
    );
  }

  const unrelated = Object.assign(new Error("other unique"), {
    code: "23505",
    constraint: "users_email_unique",
  });
  const repository = createPostgresTmcOperationRepositories(
    new QueryQueue([unrelated]).asSource(),
  ).transferRequests;
  await assert.rejects(repository.insertRequestItem(insertItemInput()), (error) =>
    error === unrelated,
  );
});

test("insertRequestItem atomically snapshots an unassigned active item", async () => {
  const input = {
    ...insertItemInput(),
    responsibilityPeriodIdAtRequest: null,
    currentResponsibleIdAtRequest: null,
  };
  const source = new QueryQueue([{
    rows: [{
      id: input.id,
      request_id: input.requestId,
      item_id: input.itemId,
      responsibility_period_id_at_request: null,
      current_responsible_id_at_request: null,
      result: "pending",
      invalid_reason: null,
      created_at: input.createdAt,
      decided_at: null,
      decided_by: null,
      version: 1,
      item_exists: true,
      item_status: "active",
      archived_at: null,
      item_version: input.expectedItemVersion,
      expected_period_open: true,
    }],
  }]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).transferRequests;

  const inserted = await repository.insertRequestItem(input);

  assert.equal(inserted.responsibilityPeriodIdAtRequest, null);
  assert.equal(inserted.currentResponsibleIdAtRequest, null);
  assert.equal(source.calls[0]?.values?.[4], null);
  assert.equal(source.calls[0]?.values?.[5], null);
  assert.match(source.calls[0]!.text, /period\.id is null/i);
});

test("findById maps the aggregate and preserves captured responsibility", async () => {
  const createdAt = new Date("2026-08-09T11:00:00.000Z");
  const source = new QueryQueue([
    { rows: [aggregateRow(createdAt)] },
  ]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;

  const result = await repository.findById(
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
  );

  assert.ok(result);
  assert.equal(result.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(result.items[0]?.currentResponsibleIdAtRequest,
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(result.items[0]?.responsibleUserProfile?.fullName,
    "Captured Owner");
  assert.equal(result.items[0]?.item.unitPrice, 125000.5);
  assert.equal(result.items[0]?.item.quantity, 2);
  assert.equal(result.items[0]?.item.photoUrl,
    "/api/inventory/items/11111111-1111-4111-8111-111111111111/photo?v=7");
  assert.equal(source.calls.length, 1);
  assert.match(
    source.calls[0]!.text,
    /order by request_item\.created_at nulls last, request_item\.id/i,
  );
  assert.doesNotMatch(source.calls[0]!.text, /now\(\)|overdue/i);
});

test("findById rejects an impossible parent without item rows", async () => {
  const source = new QueryQueue([
    { rows: [aggregateRowWithoutItem(new Date())] },
  ]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;
  await assert.rejects(
    repository.findById("ffffffff-ffff-4fff-8fff-ffffffffffff"),
    /tmc_transfer_request_without_items/,
  );
});

test("findById returns null without querying items for a missing request", async () => {
  const source = new QueryQueue([{ rows: [] }]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;

  assert.equal(
    await repository.findById("ffffffff-ffff-4fff-8fff-ffffffffffff"),
    null,
  );
  assert.equal(source.calls.length, 1);
});

test("findItemPhoto is scoped by both request and item and returns JPEG bytes", async () => {
  const source = new QueryQueue([{
    rows: [{ binary_data: Buffer.from([1, 2, 3]), trusted_mime_type: "image/jpeg" }],
  }]);
  const repository = createPostgresTmcOperationRepositories(
    source.asSource(),
  ).transferRequests;
  const requestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const itemId = "11111111-1111-4111-8111-111111111111";

  assert.deepEqual(await repository.findItemPhoto(requestId, itemId), {
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/jpeg",
  });
  assert.deepEqual(source.calls[0]?.values, [requestId, itemId]);
  assert.match(source.calls[0]!.text, /request_item\.request_id = \$1/i);
  assert.match(source.calls[0]!.text, /request_item\.item_id = \$2/i);
  assert.match(source.calls[0]!.text, /photo\.purpose = 'item'/i);
  assert.match(source.calls[0]!.text, /photo\.status = 'attached'/i);
  assert.match(source.calls[0]!.text, /photo\.attached_at desc[^\n]*photo\.id/i);
});

test("findItemPhoto returns null for an item outside the request", async () => {
  const repository = createPostgresTmcOperationRepositories(
    new QueryQueue([{ rows: [] }]).asSource(),
  ).transferRequests;
  assert.equal(await repository.findItemPhoto(
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "11111111-1111-4111-8111-111111111111",
  ), null);
});

test("decideItem atomically hands responsibility over only for a valid accept", async () => {
  const source = new QueryQueue([
    { rows: [{ version: 1, result: "pending" }] },
    { rows: [{ status: "active", archived_at: null }] },
    { rows: [{ id: uuid(12), item_id: uuid(1), responsible_user_id: uuid(2), ended_at: null }] },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).transferRequests;
  assert.equal(await repository.decideItem({
    requestId: uuid(10), requestItemId: uuid(11), itemId: uuid(1),
    responsibilityPeriodIdAtRequest: uuid(12), currentResponsibleIdAtRequest: uuid(2),
    expectedVersion: 1, decision: "accept", recipientId: uuid(3), decidedBy: uuid(3),
    decidedAt: new Date("2026-08-10T12:00:00.000Z"), newResponsibilityPeriodId: uuid(13),
  }), "accepted");
  assert.equal(source.calls.length, 6);
  assert.match(source.calls[3]!.text, /tmc_transfer_accepted/i);
  assert.match(source.calls[4]!.text, /'transfer'/i);
  assert.match(source.calls[5]!.text, /result = \$2[\s\S]+version = version \+ 1/i);
});

test("decideItem assigns an item that was still unassigned when accepted", async () => {
  const source = new QueryQueue([
    { rows: [{ version: 1, result: "pending" }] },
    { rows: [{ status: "active", archived_at: null }] },
    { rows: [] },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).transferRequests;

  const result = await repository.decideItem({
    requestId: uuid(10), requestItemId: uuid(11), itemId: uuid(1),
    responsibilityPeriodIdAtRequest: null, currentResponsibleIdAtRequest: null,
    expectedVersion: 1, decision: "accept", recipientId: uuid(3), decidedBy: uuid(3),
    decidedAt: new Date("2026-08-10T12:00:00.000Z"), newResponsibilityPeriodId: uuid(13),
  });

  assert.equal(result, "accepted");
  assert.equal(source.calls.length, 5);
  assert.doesNotMatch(source.calls.map((call) => call.text).join("\n"), /tmc_transfer_accepted/i);
  assert.match(source.calls[3]!.text, /insert into[\s\S]+responsibility_periods/i);
  assert.match(source.calls[4]!.text, /result = \$2[\s\S]+version = version \+ 1/i);
});

test("decideItem invalidates stale inventory without creating responsibility", async () => {
  const source = new QueryQueue([
    { rows: [{ version: 1, result: "pending" }] },
    { rows: [{ status: "decommissioned", archived_at: new Date() }] },
    { rows: [{ id: uuid(12), item_id: uuid(1), responsible_user_id: uuid(2), ended_at: null }] },
    { rows: [], rowCount: 1 },
  ]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).transferRequests;
  assert.equal(await repository.decideItem({
    requestId: uuid(10), requestItemId: uuid(11), itemId: uuid(1),
    responsibilityPeriodIdAtRequest: uuid(12), currentResponsibleIdAtRequest: uuid(2),
    expectedVersion: 1, decision: "accept", recipientId: uuid(3), decidedBy: uuid(3),
    decidedAt: new Date(), newResponsibilityPeriodId: uuid(13),
  }), "invalidated");
  assert.equal(source.calls.length, 4);
  assert.equal(source.calls.some((call) => /insert into[\s\S]+responsibility_periods/i.test(call.text)), false);
  assert.equal(source.calls[3]!.values?.[2], "item_inactive");
});

test("closeRequest uses parent CAS and requires no pending children", async () => {
  const source = new QueryQueue([{ rows: [], rowCount: 1 }]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).transferRequests;
  assert.equal(await repository.closeRequest({
    requestId: uuid(10), expectedVersion: 2, status: "accepted", closedBy: uuid(3),
    closedAt: new Date(), isAdministrativeDecision: false, administrativeReason: null,
  }), true);
  assert.match(source.calls[0]!.text, /request\.version = \$2/i);
  assert.match(source.calls[0]!.text, /not exists[\s\S]+result = 'pending'/i);
});

test("stage-four history keeps participant scope and every filter parameterized", async () => {
  const source = new QueryQueue([{ rows: [] }]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).stageFour;
  await repository.listHistory({
    actorId: uuid(1), includeAll: false, status: "pending",
    createdFrom: new Date("2026-08-01T00:00:00Z"),
    createdTo: new Date("2026-08-10T00:00:00Z"),
    buildingId: uuid(2), roomId: uuid(3), itemId: uuid(4),
    overdue: true, now: new Date("2026-08-10T12:00:00Z"), limit: 50,
    requestCursorCreatedAt: new Date("2026-08-09T12:00:00Z"), requestCursorId: uuid(8),
  });
  assert.match(source.calls[0]!.text, /initiator_id = \$1\s+or request\.recipient_id = \$1/i);
  assert.match(source.calls[0]!.text, /current_responsible_id_at_request = \$1/i);
  assert.match(
    source.calls[0]!.text,
    /request_item\.current_responsible_id_at_request = \$1/i,
    "object filters must be tied to the same request item the snapshot participant may read",
  );
  assert.match(source.calls[0]!.text, /case[\s\S]+status_item\.current_responsible_id_at_request = \$1[\s\S]+status_item\.result = 'pending'/i);
  assert.match(source.calls[0]!.text, /exists[\s\S]+request_item\.item_id = \$\d+[\s\S]+item\.room_id = \$\d+[\s\S]+room\.building_id = \$\d+/i);
  assert.match(source.calls[0]!.text, /\(request\.created_at, request\.id\) < \(\$\d+, \$\d+\)/i);
  assert.equal(source.calls[0]!.text.includes(uuid(2)), false);
  assert.ok(source.calls[0]!.values?.includes(uuid(2)));
});

test("location history is scoped to responsibility at event time and preserves old/new values", async () => {
  const occurredAt = new Date("2026-08-10T12:00:00Z");
  const source = new QueryQueue([{ rows: [{
    id: uuid(9), item_id: uuid(4), item_name: "Laptop", inventory_number: "INV-1",
    actor_id: uuid(8), actor_name: "Admin", before_room_id: uuid(2),
    before_location: "A / 101", after_room_id: uuid(3), after_location: "B / 202",
    comment: "move", occurred_at: occurredAt,
  }] }]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).stageFour;
  const records = await repository.listLocationHistory({
    actorId: uuid(1), includeAll: false, createdFrom: new Date("2026-08-01T00:00:00Z"),
    roomId: uuid(2), buildingId: uuid(5), itemId: uuid(4), now: occurredAt, limit: 50,
  });
  assert.match(source.calls[0]!.text, /responsible_user_id = \$1[\s\S]+started_at <= audit\.occurred_at/i);
  assert.match(source.calls[0]!.text, /before_values->>'roomId'[\s\S]+after_values->>'roomId'/i);
  assert.equal(source.calls[0]!.text.includes(uuid(5)), false);
  assert.deepEqual(records[0], {
    id: uuid(9), itemId: uuid(4), itemName: "Laptop", inventoryNumber: "INV-1",
    actorId: uuid(8), actorName: "Admin", beforeRoomId: uuid(2), beforeLocation: "A / 101",
    afterRoomId: uuid(3), afterLocation: "B / 202", comment: "move", occurredAt,
  });
});

test("stage-four direct notifications allocate a mailbox sequence before event and delivery", async () => {
  const source = new QueryQueue([
    { rows: [{ sequence: "7" }] }, { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 }, { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
  ]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).stageFour;
  await repository.createNotification({
    id: uuid(1), domainEventId: uuid(2), type: "tmc_transfer.requested",
    actorId: uuid(3), requestId: uuid(4), itemId: null, requestRevision: 1,
    recipientId: uuid(5), audience: "direct_user", safePayload: { itemCount: 1 },
    occurredAt: new Date("2026-08-10T12:00:00Z"),
  });
  assert.equal(source.calls.length, 5);
  assert.match(source.calls[0]!.text, /on conflict \(user_id\) where kind = 'direct_user'/i);
  assert.match(source.calls[1]!.text, /subject_kind[\s\S]+'tmc_transfer_request'/i);
  assert.deepEqual(source.calls[3]!.values?.slice(0, 3), [uuid(1), uuid(5), "7"]);
  assert.match(source.calls[4]!.text, /tmc_web_push_outbox/i);
});

test("cancelRequest changes only pending children, uses parent CAS, and fences overdue push", async () => {
  const source = new QueryQueue([{ rows: [], rowCount: 2 }, { rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
  const repository = createPostgresTmcOperationRepositories(source.asSource()).transferRequests;
  assert.equal(await repository.cancelRequest({
    requestId: uuid(1), expectedVersion: 4, cancelledBy: uuid(2),
    cancelledAt: new Date(), isAdministrativeDecision: false, administrativeReason: null,
  }), true);
  assert.match(source.calls[0]!.text, /result = 'cancelled'[\s\S]+result = 'pending'/i);
  assert.match(source.calls[2]!.text, /tmc_transfer\.overdue[\s\S]+processed_at/i);
  assert.match(source.calls[1]!.text, /version = \$2 and status = 'pending'/i);
});

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "11111111-1111-4111-8111-111111111111",
    item_version: 7,
    item_status: "active",
    archived_at: null,
    item_name: "Ноутбук",
    inventory_number: "INV-001",
    quantity: "2",
    unit_price: "125000.50",
    photo_id: "77777777-7777-4777-8777-777777777777",
    building_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    building_name: "Корпус A",
    room_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    room_designation: "101",
    responsibility_period_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    responsible_user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    responsible_full_name: "Текущий сотрудник",
    responsible_email: "owner@example.com",
    responsible_role: "employee",
    responsible_is_active: true,
    responsible_deleted_at: null,
    has_active_transfer: false,
    ...overrides,
  };
}

function insertItemInput() {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    itemId: "11111111-1111-4111-8111-111111111111",
    expectedItemVersion: 7,
    responsibilityPeriodIdAtRequest:
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    currentResponsibleIdAtRequest:
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    createdAt: new Date("2026-08-09T11:00:00.000Z"),
  };
}

function requestRow(createdAt: Date) {
  return {
    request_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    initiator_id: "99999999-9999-4999-8999-999999999999",
    initiator_full_name: "Initiator",
    initiator_email: "initiator@example.com",
    initiator_role: "admin",
    recipient_id: "88888888-8888-4888-8888-888888888888",
    recipient_full_name: "Recipient",
    recipient_email: "recipient@example.com",
    recipient_role: "employee",
    request_status: "pending",
    comment: null,
    request_created_at: createdAt,
    expires_at: new Date(createdAt.getTime() + 86_400_000),
    closed_at: null,
    closed_by: null,
    closed_by_full_name: null,
    closed_by_email: null,
    closed_by_role: null,
    is_administrative_decision: false,
    administrative_reason: null,
    request_version: "1",
  };
}

function requestItemRow(createdAt: Date) {
  return {
    request_item_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    item_id: "11111111-1111-4111-8111-111111111111",
    responsibility_period_id_at_request:
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    current_responsible_id_at_request:
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    current_responsible_full_name: "Captured Owner",
    current_responsible_email: "captured@example.com",
    current_responsible_role: "employee",
    result: "pending",
    invalid_reason: null,
    request_item_created_at: createdAt,
    decided_at: null,
    decided_by: null,
    decided_by_full_name: null,
    decided_by_email: null,
    decided_by_role: null,
    request_item_version: "1",
    item_name: "Ноутбук",
    inventory_number: "INV-001",
    quantity: "2",
    unit_price: "125000.50",
    item_version: "7",
    photo_id: "77777777-7777-4777-8777-777777777777",
    building_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    building_name: "Корпус A",
    room_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    room_designation: "101",
  };
}

function aggregateRow(createdAt: Date) {
  return { ...requestRow(createdAt), ...requestItemRow(createdAt) };
}

function aggregateRowWithoutItem(createdAt: Date) {
  return {
    ...requestRow(createdAt),
    request_item_id: null,
  };
}

void (null as unknown as TmcTransferRequestRecord);
