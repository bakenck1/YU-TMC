import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type {
  ServiceRequestRecord,
  ServiceRequestRepository,
} from "../lib/application/ports/service-request-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { ServiceRequestService } from "../lib/application/services/service-request-service";
import { ApplicationError } from "../lib/domain/application-error";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const ROOM_ID = "44444444-4444-4444-8444-444444444444";

const ACTOR = {
  userId: ACTOR_ID,
  role: "employee" as const,
  sessionVersion: 7,
};

test("service request collection forwards the complete actor to the SQL scope", async () => {
  const calls: unknown[] = [];
  const service = createService({
    list: async (filters: unknown, actor: unknown) => {
      calls.push({ filters, actor });
      return [];
    },
  });

  const requests = await service.list(
    { roomId: ROOM_ID, employeeId: OTHER_ID },
    ACTOR,
  );

  assert.deepEqual(requests, []);
  assert.deepEqual(calls, [{
    filters: { roomId: ROOM_ID, employeeId: OTHER_ID },
    actor: ACTOR,
  }]);
});

test("malformed collection actors fail closed before repository access", async () => {
  let calls = 0;
  const service = createService({
    list: async () => {
      calls += 1;
      return [record()];
    },
  });

  for (const actor of [
    { userId: "not-a-uuid", role: "employee" as const, sessionVersion: 7 },
    { userId: ACTOR_ID, role: "employee" as const, sessionVersion: 0 },
    { userId: ACTOR_ID, role: "employee" as const, sessionVersion: 1.5 },
  ]) {
    await assert.rejects(
      service.list({}, actor),
      (error) =>
        error instanceof ApplicationError &&
        error.kind === "unauthorized" &&
        error.publicCode === "unauthorized",
    );
  }
  assert.equal(calls, 0);
});

test("employee POST does not disclose whether an unassigned item exists", async () => {
  const service = createService({
    findItemContext: async () => ({
      roomId: ROOM_ID,
      roomResponsibleId: OTHER_ID,
      itemResponsibleId: OTHER_ID,
    }),
  });

  await assert.rejects(
    service.create(input(), ACTOR),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "not_found" &&
      error.publicCode === "item_not_found",
  );
});

test("revoked session is revalidated under the POST transaction lock", async () => {
  let insertCalls = 0;
  const service = createService({
    findItemContext: async () => ({
      roomId: ROOM_ID,
      roomResponsibleId: ACTOR_ID,
      itemResponsibleId: null,
    }),
    findCreateAuthorizationForUpdate: async () => ({
      actor: {
        id: ACTOR_ID,
        role: "employee",
        active: true,
        deletedAt: null,
        version: ACTOR.sessionVersion + 1,
      },
      item: {
        roomId: ROOM_ID,
        roomResponsibleId: ACTOR_ID,
        itemResponsibleId: null,
      },
    }),
    insert: async () => {
      insertCalls += 1;
      return record();
    },
  });

  await assert.rejects(
    service.create(input(), ACTOR),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "unauthorized" &&
      error.publicCode === "unauthorized",
  );
  assert.equal(insertCalls, 0);
});

test("service-request photo revalidates the session before reading the object", async () => {
  let requestReads = 0;
  let photoReads = 0;
  const service = createService({
    findAuthorizationUserForUpdate: async () => ({
      id: ACTOR_ID,
      role: "employee",
      active: true,
      deletedAt: null,
      version: ACTOR.sessionVersion + 1,
    }),
    findByIdForUpdate: async () => {
      requestReads += 1;
      return record();
    },
    findPhoto: async () => {
      photoReads += 1;
      return { bytes: new Uint8Array([1]), mediaType: "image/jpeg" as const };
    },
  });

  await assert.rejects(
    service.getPhoto(record().id, ACTOR),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "unauthorized" &&
      error.publicCode === "unauthorized",
  );
  assert.equal(requestReads, 0);
  assert.equal(photoReads, 0);
});

test("employee ownership is revalidated under the POST transaction lock", async () => {
  let insertCalls = 0;
  const service = createService({
    findItemContext: async () => ({
      roomId: ROOM_ID,
      roomResponsibleId: ACTOR_ID,
      itemResponsibleId: null,
    }),
    findCreateAuthorizationForUpdate: async () => ({
      actor: {
        id: ACTOR_ID,
        role: "employee",
        active: true,
        deletedAt: null,
        version: ACTOR.sessionVersion,
      },
      item: {
        roomId: ROOM_ID,
        roomResponsibleId: OTHER_ID,
        itemResponsibleId: OTHER_ID,
      },
    }),
    insert: async () => {
      insertCalls += 1;
      return record();
    },
  });

  await assert.rejects(
    service.create(input(), ACTOR),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "not_found" &&
      error.publicCode === "item_not_found",
  );
  assert.equal(insertCalls, 0);
});

test("Postgres list and create authorization are bound to current DB state", async () => {
  const source = await readFile(
    "lib/server/persistence/postgres/postgres-service-request-repositories.ts",
    "utf8",
  );

  assert.match(source, /authorized_actor\.version\s*=\s*\$\$\{actorVersionIndex\}/);
  assert.match(source, /authorized_actor\.role\s*=\s*\$\$\{actorRoleIndex\}/);
  assert.match(source, /authorized_actor\.is_active\s*=\s*true/);
  assert.match(source, /authorized_actor\.deleted_at\s+is\s+null/);
  assert.match(source, /findCreateAuthorizationForUpdate/);
  assert.match(source, /from \$\{USERS\}[\s\S]*for update/);
  assert.match(source, /for update of i, r/);
  assert.match(source, /ended_at is null[\s\S]*for update/);
});

test("collection responses explicitly prevent authenticated PII caching", async () => {
  const route = await readFile("app/api/service-requests/route.ts", "utf8");

  assert.match(route, /private, no-store, max-age=0, must-revalidate/);
  assert.match(route, /applicationErrorResponse\(error, PRIVATE_RESPONSE_HEADERS\)/);
});

function createService(overrides: Record<string, unknown>) {
  const repository = {
    list: async () => [],
    findById: async () => null,
    findItemContext: async () => null,
    insert: async () => record(),
    updateStatus: async () => null,
    findPhoto: async () => null,
    appendAudit: async () => undefined,
    ...overrides,
  } as unknown as ServiceRequestRepository;
  const repositories = { requests: repository };
  const unitOfWork: UnitOfWork<typeof repositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new ServiceRequestService(
    unitOfWork,
    { now: () => new Date("2026-08-14T08:00:00.000Z") },
    { create: () => "55555555-5555-4555-8555-555555555555" },
    {
      normalize: async () => ({
        bytes: new Uint8Array([1]),
        width: 1,
        height: 1,
        mediaType: "image/jpeg" as const,
      }),
    },
  );
}

function input() {
  return {
    itemId: ITEM_ID,
    type: "damaged" as const,
    description: "Screen damage",
    photo: { imageDataUrl: "data:image/jpeg;base64,AQ==", width: 1, height: 1 },
  };
}

function record(): ServiceRequestRecord {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    itemId: ITEM_ID,
    itemName: "Laptop",
    inventoryNumber: "INV-1",
    roomId: ROOM_ID,
    roomDesignation: "101",
    buildingName: "Main",
    authorId: ACTOR_ID,
    authorName: "Employee",
    responsibleId: ACTOR_ID,
    responsibleName: "Employee",
    roomResponsibleId: ACTOR_ID,
    itemResponsibleId: null,
    type: "damaged",
    description: "Screen damage",
    status: "new",
    createdAt: new Date("2026-08-14T08:00:00.000Z"),
    updatedAt: new Date("2026-08-14T08:00:00.000Z"),
    version: 1,
  };
}
