import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { createPostgresInventoryResponsibilityRepositories } from "../lib/server/persistence/postgres/postgres-inventory-responsibility-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

interface QueryCall {
  text: string;
  values: readonly unknown[] | undefined;
}

class QueryQueue {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly responses: Array<{ rows: unknown[]; rowCount?: number }>,
  ) {}

  readonly query = async (text: string, values?: readonly unknown[]) => {
    this.calls.push({ text, values });
    const response = this.responses.shift();
    if (!response) throw new Error("unexpected_query");
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

test("legacy transfer decision vertical slice type-checks", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join("node_modules", "typescript", "bin", "tsc"),
      "--project",
      path.join(
        "tests",
        "typecheck",
        "tsconfig.inventory-transfer-decision.json",
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

test("decision lookup scopes and locks the transfer by actor in SQL", async () => {
  const source = new QueryQueue([{ rows: [transferRow()] }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.findTransferForDecision(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  );

  assert.equal(result?.currentResponsibleIdAtRequest, "22222222-2222-4222-8222-222222222222");
  assert.deepEqual(source.calls[0]?.values, [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  assert.match(
    source.calls[0]!.text,
    /where t\.id = \$1 and t\.current_responsible_id_at_request = \$2/i,
  );
  assert.match(source.calls[0]!.text, /for update of t/i);
});

test("decision reauthorization and item snapshot are both transaction-locked", async () => {
  const source = new QueryQueue([
    {
      rows: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          role: "employee",
          is_active: true,
          deleted_at: null,
          version: 9,
        },
      ],
    },
    {
      rows: [
        {
          item_id: "33333333-3333-4333-8333-333333333333",
          item_status: "active",
          responsibility_period_id: "44444444-4444-4444-8444-444444444444",
          responsible_user_id: "22222222-2222-4222-8222-222222222222",
          responsible_name: "Owner",
        },
      ],
    },
  ]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  await repository.findAuthorizationUserForUpdate(
    "22222222-2222-4222-8222-222222222222",
  );
  await repository.findItemStateForUpdate(
    "33333333-3333-4333-8333-333333333333",
  );

  assert.match(source.calls[0]!.text, /select id, role, is_active, deleted_at, version/i);
  assert.match(source.calls[0]!.text, /for update/i);
  assert.match(source.calls[1]!.text, /for update of rp/i);
  assert.match(source.calls[1]!.text, /for update of i/i);
});

test("cancellation lookup scopes and locks the transfer by requester in SQL", async () => {
  const source = new QueryQueue([{ rows: [transferRow()] }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.findTransferForCancellation(
    "11111111-1111-4111-8111-111111111111",
    "55555555-5555-4555-8555-555555555555",
  );

  assert.equal(result?.requestedBy, "55555555-5555-4555-8555-555555555555");
  assert.deepEqual(source.calls[0]?.values, [
    "11111111-1111-4111-8111-111111111111",
    "55555555-5555-4555-8555-555555555555",
  ]);
  assert.match(
    source.calls[0]!.text,
    /where t\.id = \$1 and t\.requested_by = \$2/i,
  );
  assert.match(source.calls[0]!.text, /for update of t/i);
});

test("cancellation CAS repeats requester ownership in the SQL update", async () => {
  const source = new QueryQueue([
    { rows: [], rowCount: 1 },
    {
      rows: [{
        ...transferRow(),
        status: "cancelled",
        closed_at: new Date("2026-08-13T08:00:00.000Z"),
        version: 2,
      }],
    },
  ]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;
  const closedAt = new Date("2026-08-13T08:00:00.000Z");

  const result = await repository.cancelTransfer({
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    requestedBy: "55555555-5555-4555-8555-555555555555",
    closedBy: "55555555-5555-4555-8555-555555555555",
    closedAt,
  });

  assert.equal(result?.status, "cancelled");
  assert.deepEqual(source.calls[0]?.values, [
    "11111111-1111-4111-8111-111111111111",
    closedAt,
    "55555555-5555-4555-8555-555555555555",
    1,
    "55555555-5555-4555-8555-555555555555",
  ]);
  assert.match(
    source.calls[0]!.text,
    /where id = \$1 and version = \$4 and status = 'pending_current_owner'\s+and requested_by = \$5/i,
  );
});

test("a lost cancellation CAS does not perform a post-update disclosure lookup", async () => {
  const source = new QueryQueue([{ rows: [], rowCount: 0 }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.cancelTransfer({
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    requestedBy: "55555555-5555-4555-8555-555555555555",
    closedBy: "55555555-5555-4555-8555-555555555555",
    closedAt: new Date("2026-08-13T08:00:00.000Z"),
  });

  assert.equal(result, null);
  assert.equal(source.calls.length, 1);
});

test("override lookup locks the exact transfer before authorization-bound mutation", async () => {
  const source = new QueryQueue([{ rows: [transferRow()] }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.findTransferForOverride(
    "11111111-1111-4111-8111-111111111111",
  );

  assert.equal(result?.id, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(source.calls[0]?.values, [
    "11111111-1111-4111-8111-111111111111",
  ]);
  assert.match(source.calls[0]!.text, /where t\.id = \$1/i);
  assert.match(source.calls[0]!.text, /for update of t/i);
});

test("override CAS repeats transfer, responsibility, live-admin and target bindings in SQL", async () => {
  const closedAt = new Date("2026-08-13T08:00:00.000Z");
  const source = new QueryQueue([
    { rows: [], rowCount: 1 },
    {
      rows: [{
        ...transferRow(),
        status: "overridden",
        closed_at: closedAt,
        version: 2,
      }],
    },
  ]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.overrideTransfer({
    id: "11111111-1111-4111-8111-111111111111",
    expectedItemId: "33333333-3333-4333-8333-333333333333",
    expectedResponsibilityPeriodId: "66666666-6666-4666-8666-666666666666",
    expectedCurrentResponsibleId: "22222222-2222-4222-8222-222222222222",
    version: 1,
    administratorId: "77777777-7777-4777-8777-777777777777",
    administratorSessionVersion: 9,
    closedAt,
    administrativeReason: "Emergency assignment",
    overrideOutcome: "assigned",
    overrideResponsibleId: "88888888-8888-4888-8888-888888888888",
  });

  assert.equal(result?.status, "overridden");
  assert.deepEqual(source.calls[0]?.values, [
    "11111111-1111-4111-8111-111111111111",
    closedAt,
    "77777777-7777-4777-8777-777777777777",
    "Emergency assignment",
    "assigned",
    "88888888-8888-4888-8888-888888888888",
    1,
    "33333333-3333-4333-8333-333333333333",
    "66666666-6666-4666-8666-666666666666",
    "22222222-2222-4222-8222-222222222222",
    9,
  ]);
  const sql = source.calls[0]!.text;
  assert.match(
    sql,
    /where id = \$1 and version = \$7 and status = 'pending_current_owner'\s+and item_id = \$8\s+and current_responsible_id_at_request = \$10/i,
  );
  assert.match(
    sql,
    /current_period\.id = \$9[\s\S]*current_period\.item_id = \$8[\s\S]*current_period\.responsible_user_id = \$10[\s\S]*current_period\.ended_at is null/i,
  );
  assert.match(
    sql,
    /administrator\.id = \$3[\s\S]*administrator\.role = 'admin'[\s\S]*administrator\.is_active = true[\s\S]*administrator\.deleted_at is null[\s\S]*administrator\.version = \$11/i,
  );
  assert.match(
    sql,
    /\$5(?:::[^\s]+)? = 'assigned'[\s\S]*\$6(?:::uuid)? <> \$10[\s\S]*target\.id = \$6(?:::uuid)?[\s\S]*target\.role = 'employee'[\s\S]*target\.is_active = true[\s\S]*target\.deleted_at is null/i,
  );
});

test("a lost override CAS performs no post-update disclosure lookup", async () => {
  const source = new QueryQueue([{ rows: [], rowCount: 0 }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.overrideTransfer({
    id: "11111111-1111-4111-8111-111111111111",
    expectedItemId: "33333333-3333-4333-8333-333333333333",
    expectedResponsibilityPeriodId: "66666666-6666-4666-8666-666666666666",
    expectedCurrentResponsibleId: "22222222-2222-4222-8222-222222222222",
    version: 1,
    administratorId: "77777777-7777-4777-8777-777777777777",
    administratorSessionVersion: 9,
    closedAt: new Date("2026-08-13T08:00:00.000Z"),
    administrativeReason: "Emergency release",
    overrideOutcome: "released",
    overrideResponsibleId: null,
  });

  assert.equal(result, null);
  assert.equal(source.calls.length, 1);
});

test("transfer collection atomically binds participant scope to the live actor", async () => {
  const source = new QueryQueue([{ rows: [transferRow()] }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.listTransfersForAuthorizedUser({
    userId: "22222222-2222-4222-8222-222222222222",
    role: "employee",
    sessionVersion: 9,
  });

  assert.equal(result.length, 1);
  assert.deepEqual(source.calls[0]?.values, [
    "22222222-2222-4222-8222-222222222222",
    "employee",
    9,
  ]);
  assert.match(
    source.calls[0]!.text,
    /t\.requested_by = \$1\s+or t\.current_responsible_id_at_request = \$1/i,
  );
  assert.match(source.calls[0]!.text, /authorized_actor\.id = \$1/i);
  assert.match(source.calls[0]!.text, /authorized_actor\.role = \$2/i);
  assert.match(source.calls[0]!.text, /authorized_actor\.is_active = true/i);
  assert.match(source.calls[0]!.text, /authorized_actor\.deleted_at is null/i);
  assert.match(source.calls[0]!.text, /authorized_actor\.version = \$3/i);
});

test("an unauthorized transfer collection returns no rows without an unscoped fallback", async () => {
  const source = new QueryQueue([{ rows: [] }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;

  const result = await repository.listTransfersForAuthorizedUser({
    userId: "22222222-2222-4222-8222-222222222222",
    role: "employee",
    sessionVersion: 10,
  });

  assert.deepEqual(result, []);
  assert.equal(source.calls.length, 1);
});

test("decision audit persists the canonical reason and resulting revision", async () => {
  const source = new QueryQueue([{ rows: [], rowCount: 1 }]);
  const repository = createPostgresInventoryResponsibilityRepositories(
    source.asSource(),
  ).responsibility;
  const occurredAt = new Date("2026-08-13T08:00:00.000Z");

  await repository.appendAudit({
    id: "11111111-1111-4111-8111-111111111111",
    actorId: "22222222-2222-4222-8222-222222222222",
    actorRole: "employee",
    subjectKind: "transfer",
    subjectId: "33333333-3333-4333-8333-333333333333",
    subjectRevision: 2,
    action: "transfer.rejected",
    beforeValues: { status: "pending_current_owner" },
    afterValues: { status: "rejected", decisionComment: "Duplicate asset" },
    reason: "Duplicate asset",
    isAdministrativeException: false,
    occurredAt,
  });

  assert.match(source.calls[0]!.text, /subject_revision/i);
  assert.match(source.calls[0]!.text, /reason,\s*is_administrative_exception/i);
  assert.deepEqual(source.calls[0]?.values?.slice(5), [
    2,
    "transfer.rejected",
    { status: "pending_current_owner" },
    { status: "rejected", decisionComment: "Duplicate asset" },
    "Duplicate asset",
    false,
    occurredAt,
  ]);
});

function transferRow() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    item_id: "33333333-3333-4333-8333-333333333333",
    item_name: "Laptop",
    item_inventory_number: "INV-1",
    requested_by: "55555555-5555-4555-8555-555555555555",
    requested_by_name: "Requester",
    proposed_responsible_id: "55555555-5555-4555-8555-555555555555",
    current_responsible_id_at_request: "22222222-2222-4222-8222-222222222222",
    current_responsible_name: "Owner",
    status: "pending_current_owner",
    requested_at: new Date("2026-08-13T07:00:00.000Z"),
    closed_at: null,
    decision_comment: null,
    version: 1,
  };
}
