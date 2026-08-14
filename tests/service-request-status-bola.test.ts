import assert from "node:assert/strict";
import test from "node:test";

import type {
  ServiceRequestAuthorizationUser,
  ServiceRequestRecord,
  ServiceRequestRepositories,
  ServiceRequestRepository,
} from "../lib/application/ports/service-request-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { ServiceRequestService } from "../lib/application/services/service-request-service";
import { ApplicationError } from "../lib/domain/application-error";
import { createPostgresServiceRequestRepositories } from "../lib/server/persistence/postgres/postgres-service-request-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";
const ROOM_ID = "66666666-6666-4666-8666-666666666666";
const RESPONSIBLE_ID = "77777777-7777-4777-8777-777777777777";
const ACTOR = {
  userId: ADMIN_ID,
  role: "admin" as const,
  sessionVersion: 7,
};

test("only the live session-bound database administrator can update a service request", async () => {
  const denied: Array<ServiceRequestAuthorizationUser | null> = [
    null,
    authorizationUser({ active: false }),
    authorizationUser({ deletedAt: new Date("2026-08-14T07:00:00.000Z") }),
    authorizationUser({ role: "employee" }),
    authorizationUser({ role: "warehouse" }),
    authorizationUser({ version: ACTOR.sessionVersion + 1 }),
    authorizationUser({ id: OTHER_ADMIN_ID }),
  ];

  for (const currentActor of denied) {
    let requestLookups = 0;
    let mutations = 0;
    const harness = createHarness({
      findAuthorizationUserForUpdate: async () => currentActor,
      findById: async () => {
        requestLookups += 1;
        return requestRecord();
      },
      findByIdForUpdate: async () => {
        requestLookups += 1;
        return requestRecord();
      },
      updateStatus: async () => {
        mutations += 1;
        throw new Error("must_not_mutate");
      },
    });

    await assert.rejects(
      harness.service.updateStatus(REQUEST_ID, "in_progress", 1, ACTOR),
      unauthorized,
    );
    assert.equal(requestLookups, 0);
    assert.equal(mutations, 0);
  }
});

test("all non-admin roles and alternate request IDs fail before resource lookup", async () => {
  for (const role of ["warehouse", "employee"] as const) {
    for (const id of [REQUEST_ID, OTHER_REQUEST_ID, "not-a-uuid"]) {
      let lookups = 0;
      const harness = createHarness({
        findAuthorizationUserForUpdate: async () => {
          lookups += 1;
          return authorizationUser({ role });
        },
        findById: async () => {
          lookups += 1;
          return requestRecord({ id });
        },
        findByIdForUpdate: async () => {
          lookups += 1;
          return requestRecord({ id });
        },
      });

      await assert.rejects(
        harness.service.updateStatus(id, "in_progress", 1, {
          ...ACTOR,
          role,
        }),
        forbidden,
      );
      assert.equal(lookups, 0);
    }
  }
});

test("malformed authenticated actors and int4-overflow versions fail before repository access", async () => {
  const invalidActors = [
    { ...ACTOR, userId: "not-a-uuid" },
    { ...ACTOR, sessionVersion: 0 },
    { ...ACTOR, sessionVersion: 1.5 },
    { ...ACTOR, sessionVersion: Number.NaN },
  ];
  for (const actor of invalidActors) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.updateStatus(REQUEST_ID, "in_progress", 1, actor),
      unauthorized,
    );
    assert.deepEqual(harness.calls, []);
  }

  for (const version of [0, 1.5, 2_147_483_648, Number.NaN]) {
    const harness = createHarness();
    await assert.rejects(
      harness.service.updateStatus(REQUEST_ID, "in_progress", version, ACTOR),
      invalidRequest,
    );
    assert.deepEqual(harness.calls, []);
  }
});

test("admin status targets, including the UI-supported correction path, bind the locked snapshot", async () => {
  const transitions = [
    ["new", "in_progress"],
    ["in_progress", "completed"],
    ["completed", "new"],
  ] as const;

  for (const [before, after] of transitions) {
    const harness = createHarness({ initial: requestRecord({ status: before }) });
    const result = await harness.service.updateStatus(
      REQUEST_ID.toUpperCase(),
      after,
      1,
      { ...ACTOR, userId: ADMIN_ID.toUpperCase() },
    );

    assert.equal(result.id, REQUEST_ID);
    assert.equal(result.status, after);
    assert.equal(result.version, 2);
    assert.deepEqual(harness.calls.slice(0, 3), [
      `actor:${ADMIN_ID}`,
      `request:${REQUEST_ID}`,
      `update:${REQUEST_ID}:${before}:${after}:1:${ADMIN_ID}:7`,
    ]);
    assert.deepEqual(harness.audits, [{
      id: "88888888-8888-4888-8888-888888888888",
      actorId: ADMIN_ID,
      actorRole: "admin",
      subjectId: REQUEST_ID,
      subjectRevision: 2,
      action: "service_request.status_changed",
      beforeValues: { status: before },
      afterValues: { status: after },
      occurredAt: new Date("2026-08-14T08:00:00.000Z"),
    }]);
  }
});

test("status/version races produce one stable conflict and no audit", async () => {
  for (const loseRace of ["version", "status", "authorization"] as const) {
    const harness = createHarness({
      updateStatus: async () => {
        harness.calls.push(`lost:${loseRace}`);
        return null;
      },
    });

    await assert.rejects(
      harness.service.updateStatus(REQUEST_ID, "in_progress", 1, ACTOR),
      versionConflict,
    );
    assert.deepEqual(harness.audits, []);
  }
});

test("a concurrent ownership change neither grants non-admin access nor replaces the path request", async () => {
  const harness = createHarness({
    initial: requestRecord({ responsibleId: RESPONSIBLE_ID }),
    updated: requestRecord({
      responsibleId: OTHER_ADMIN_ID,
      responsibleName: "Replacement owner",
      status: "in_progress",
      version: 2,
    }),
  });

  const result = await harness.service.updateStatus(
    REQUEST_ID,
    "in_progress",
    1,
    ACTOR,
  );
  assert.equal(result.id, REQUEST_ID);
  assert.equal(result.responsible?.id, OTHER_ADMIN_ID);

  const employeeHarness = createHarness({
    initial: requestRecord({ responsibleId: ADMIN_ID }),
  });
  await assert.rejects(
    employeeHarness.service.updateStatus(
      OTHER_REQUEST_ID,
      "completed",
      1,
      { ...ACTOR, role: "employee" },
    ),
    forbidden,
  );
  assert.deepEqual(employeeHarness.calls, []);
});

test("Postgres status authorization and request lookup lock exact rows", async () => {
  const source = new QueryQueue([
    { rows: [authorizationRow()] },
    { rows: [requestRow()] },
  ]);
  const repository = createPostgresServiceRequestRepositories(
    source.asSource(),
  ).requests;

  const actor = await repository.findAuthorizationUserForUpdate(ADMIN_ID);
  const request = await repository.findByIdForUpdate(REQUEST_ID);

  assert.equal(actor?.id, ADMIN_ID);
  assert.equal(request?.id, REQUEST_ID);
  assert.deepEqual(source.calls[0]?.values, [ADMIN_ID]);
  assert.match(source.calls[0]!.text, /where id = \$1\s+for update/i);
  assert.deepEqual(source.calls[1]?.values, [REQUEST_ID]);
  assert.match(source.calls[1]!.text, /where request\.id = \$1/i);
  assert.match(source.calls[1]!.text, /for update of request/i);
});

test("Postgres status CAS repeats ID, state, version and live session-bound admin scope", async () => {
  const occurredAt = new Date("2026-08-14T08:00:00.000Z");
  const source = new QueryQueue([
    { rows: [], rowCount: 1 },
    {
      rows: [requestRow({
        status: "in_progress",
        version: 2,
        updated_at: occurredAt,
      })],
    },
  ]);
  const repository = createPostgresServiceRequestRepositories(
    source.asSource(),
  ).requests;

  const updated = await repository.updateStatus({
    id: REQUEST_ID,
    status: "in_progress",
    expectedStatus: "new",
    actorId: ADMIN_ID,
    actorRole: "admin",
    actorSessionVersion: 7,
    expectedVersion: 1,
    occurredAt,
  });

  assert.equal(updated?.status, "in_progress");
  assert.deepEqual(source.calls[0]?.values, [
    REQUEST_ID,
    "in_progress",
    ADMIN_ID,
    occurredAt,
    1,
    "new",
    "admin",
    7,
  ]);
  const sql = source.calls[0]!.text;
  assert.match(sql, /request\.id = \$1/i);
  assert.match(sql, /request\.version = \$5/i);
  assert.match(sql, /request\.status = \$6/i);
  assert.match(sql, /authorized_actor\.id = \$3/i);
  assert.match(sql, /authorized_actor\.role = \$7/i);
  assert.match(sql, /authorized_actor\.is_active = true/i);
  assert.match(sql, /authorized_actor\.deleted_at is null/i);
  assert.match(sql, /authorized_actor\.version = \$8/i);
  assert.deepEqual(source.calls[1]?.values, [REQUEST_ID]);
});

test("a lost Postgres status CAS performs no disclosure lookup", async () => {
  const source = new QueryQueue([{ rows: [], rowCount: 0 }]);
  const repository = createPostgresServiceRequestRepositories(
    source.asSource(),
  ).requests;

  const result = await repository.updateStatus({
    id: REQUEST_ID,
    status: "completed",
    expectedStatus: "in_progress",
    actorId: ADMIN_ID,
    actorRole: "admin",
    actorSessionVersion: 7,
    expectedVersion: 2,
    occurredAt: new Date("2026-08-14T08:00:00.000Z"),
  });

  assert.equal(result, null);
  assert.equal(source.calls.length, 1);
});

function createHarness(options: {
  initial?: ServiceRequestRecord;
  updated?: ServiceRequestRecord;
  findAuthorizationUserForUpdate?: ServiceRequestRepository["findAuthorizationUserForUpdate"];
  findById?: ServiceRequestRepository["findById"];
  findByIdForUpdate?: ServiceRequestRepository["findByIdForUpdate"];
  updateStatus?: ServiceRequestRepository["updateStatus"];
} = {}) {
  let current = structuredClone(options.initial ?? requestRecord());
  const calls: string[] = [];
  const audits: Array<Parameters<ServiceRequestRepository["appendAudit"]>[0]> = [];
  const repository: ServiceRequestRepository = {
    list: async () => [],
    findById: options.findById ?? (async (id) =>
      current.id === id ? structuredClone(current) : null),
    findByIdForUpdate: options.findByIdForUpdate ?? (async (id) => {
      calls.push(`request:${id}`);
      return current.id === id ? structuredClone(current) : null;
    }),
    findAuthorizationUserForUpdate:
      options.findAuthorizationUserForUpdate ?? (async (id) => {
        calls.push(`actor:${id}`);
        return id === ADMIN_ID ? authorizationUser() : null;
      }),
    findItemContext: async () => null,
    findCreateAuthorizationForUpdate: async () => ({ actor: null, item: null }),
    insert: async () => structuredClone(current),
    updateStatus: options.updateStatus ?? (async (input) => {
      calls.push(
        `update:${input.id}:${input.expectedStatus}:${input.status}:${input.expectedVersion}:${input.actorId}:${input.actorSessionVersion}`,
      );
      if (
        input.id !== current.id ||
        input.expectedStatus !== current.status ||
        input.expectedVersion !== current.version ||
        input.actorId !== ADMIN_ID ||
        input.actorRole !== "admin" ||
        input.actorSessionVersion !== ACTOR.sessionVersion
      ) return null;
      current = structuredClone(options.updated ?? {
        ...current,
        status: input.status,
        updatedAt: input.occurredAt,
        version: current.version + 1,
      });
      return structuredClone(current);
    }),
    findPhoto: async () => null,
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  const repositories: ServiceRequestRepositories = { requests: repository };
  const unitOfWork: UnitOfWork<ServiceRequestRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => {
      const before = structuredClone(current);
      const auditCount = audits.length;
      try {
        return await work(repositories);
      } catch (error) {
        current = before;
        audits.splice(auditCount);
        throw error;
      }
    },
  };
  return {
    audits,
    calls,
    service: new ServiceRequestService(
      unitOfWork,
      { now: () => new Date("2026-08-14T08:00:00.000Z") },
      { create: () => "88888888-8888-4888-8888-888888888888" },
      {
        normalize: async () => ({
          bytes: new Uint8Array([1]),
          width: 1,
          height: 1,
          mediaType: "image/jpeg" as const,
        }),
      },
    ),
  };
}

function authorizationUser(
  overrides: Partial<ServiceRequestAuthorizationUser> = {},
): ServiceRequestAuthorizationUser {
  return {
    id: ADMIN_ID,
    role: "admin",
    active: true,
    deletedAt: null,
    version: ACTOR.sessionVersion,
    ...overrides,
  };
}

function requestRecord(
  overrides: Partial<ServiceRequestRecord> = {},
): ServiceRequestRecord {
  return {
    id: REQUEST_ID,
    itemId: ITEM_ID,
    itemName: "Laptop",
    inventoryNumber: "INV-1",
    roomId: ROOM_ID,
    roomDesignation: "101",
    buildingName: "Main",
    authorId: RESPONSIBLE_ID,
    authorName: "Employee",
    responsibleId: RESPONSIBLE_ID,
    responsibleName: "Employee",
    roomResponsibleId: RESPONSIBLE_ID,
    itemResponsibleId: null,
    type: "damaged",
    description: "Screen damage",
    status: "new",
    createdAt: new Date("2026-08-14T07:00:00.000Z"),
    updatedAt: new Date("2026-08-14T07:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

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

function authorizationRow() {
  return {
    id: ADMIN_ID,
    role: "admin",
    is_active: true,
    deleted_at: null,
    version: ACTOR.sessionVersion,
  };
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    item_id: ITEM_ID,
    item_name: "Laptop",
    inventory_number: "INV-1",
    room_id: ROOM_ID,
    room_designation: "101",
    building_name: "Main",
    author_id: RESPONSIBLE_ID,
    author_name: "Employee",
    responsible_id: RESPONSIBLE_ID,
    responsible_name: "Employee",
    room_responsible_id: RESPONSIBLE_ID,
    item_responsible_id: null,
    type: "damaged",
    description: "Screen damage",
    status: "new",
    created_at: new Date("2026-08-14T07:00:00.000Z"),
    updated_at: new Date("2026-08-14T07:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

function applicationError(
  error: unknown,
  kind: ApplicationError["kind"],
  publicCode: string,
) {
  return (
    error instanceof ApplicationError &&
    error.kind === kind &&
    error.publicCode === publicCode
  );
}

const unauthorized = (error: unknown) =>
  applicationError(error, "unauthorized", "unauthorized");
const forbidden = (error: unknown) =>
  applicationError(error, "forbidden", "forbidden");
const invalidRequest = (error: unknown) =>
  applicationError(error, "validation", "invalid_service_request");
const versionConflict = (error: unknown) =>
  applicationError(error, "conflict", "version_conflict");
