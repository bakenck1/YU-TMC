import assert from "node:assert/strict";
import test from "node:test";

import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import type {
  UserRecord,
  UserRepositories,
} from "../lib/application/ports/user-repositories";
import { UserService } from "../lib/application/services/user-service";
import { ApplicationError } from "../lib/domain/application-error";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

type RecipientActor = {
  userId: string;
  role: "admin" | "warehouse" | "employee";
  sessionVersion: number;
};

type RecipientSearch = (
  query: string,
  actor: RecipientActor,
) => Promise<unknown>;

test("direct recipient search atomically reauthorizes the complete live actor", async () => {
  const calls: string[] = [];
  const actor = user(ACTOR_ID, "employee", 7);
  const repositories = {
    users: {
      findByIdForUpdate: async (id: string) => {
        calls.push(`actor:${id}`);
        return actor;
      },
      searchActiveRecipients: async (
        query: string,
        excludeUserId: string,
        limit: number,
      ) => {
        calls.push(`search:${query}:${excludeUserId}:${limit}`);
        return [{
          id: TARGET_ID,
          fullName: "Target User",
          email: "target@example.test",
          role: "employee" as const,
        }];
      },
    },
  } as unknown as UserRepositories;
  const unitOfWork: UnitOfWork<UserRepositories> = {
    read: async () => {
      throw new Error("unscoped_read_must_not_run");
    },
    transaction: async (work, options) => {
      calls.push(`transaction:${options?.isolation}:${options?.readOnly}`);
      return work(repositories);
    },
  };
  const service = createService(unitOfWork);
  const search = service.searchTmcRecipients.bind(service) as RecipientSearch;

  assert.deepEqual(
    await search("  ALI  ", {
      userId: ACTOR_ID.toUpperCase(),
      role: "employee",
      sessionVersion: 7,
    }),
    [{
      id: TARGET_ID,
      fullName: "Target User",
      email: "target@example.test",
      role: "employee",
    }],
  );
  assert.deepEqual(calls, [
    "transaction:repeatable-read:false",
    `actor:${ACTOR_ID}`,
    `search:ali:${ACTOR_ID}:20`,
  ]);
});

test("direct recipient search rejects stale, forged, inactive and deleted actors before directory access", async () => {
  for (const [name, supplied, live] of [
    ["stale session", actor("employee", 6), user(ACTOR_ID, "employee", 7)],
    ["forged role", actor("admin", 7), user(ACTOR_ID, "employee", 7)],
    ["inactive", actor("employee", 7), { ...user(ACTOR_ID, "employee", 7), active: false }],
    ["deleted", actor("employee", 7), { ...user(ACTOR_ID, "employee", 7), deletedAt: new Date() }],
  ] as const) {
    let searched = false;
    const repositories = {
      users: {
        findByIdForUpdate: async () => live,
        searchActiveRecipients: async () => {
          searched = true;
          return [];
        },
      },
    } as unknown as UserRepositories;
    const service = createService({
      read: async () => {
        throw new Error("unscoped_read_must_not_run");
      },
      transaction: async (work) => work(repositories),
    });
    const search = service.searchTmcRecipients.bind(service) as RecipientSearch;

    await assert.rejects(
      search("ali", supplied),
      (error) =>
        error instanceof ApplicationError &&
        error.kind === "forbidden" &&
        error.publicCode === "forbidden",
      name,
    );
    assert.equal(searched, false, name);
  }
});

test("direct recipient search validates actor and query bounds before repository access", async () => {
  let calls = 0;
  const service = createService({
    read: async () => {
      calls += 1;
      throw new Error("repository_must_not_run");
    },
    transaction: async () => {
      calls += 1;
      throw new Error("repository_must_not_run");
    },
  });
  const search = service.searchTmcRecipients.bind(service) as RecipientSearch;

  for (const supplied of [
    { ...actor("employee", 7), userId: "not-a-uuid" },
    actor("employee", 0),
    actor("employee", 1.5),
  ]) {
    await assert.rejects(
      search("ali", supplied),
      (error) =>
        error instanceof ApplicationError &&
        error.kind === "forbidden" &&
        error.publicCode === "forbidden",
    );
  }
  await assert.rejects(
    search("a".repeat(65), actor("employee", 7)),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "validation" &&
      error.publicCode === "recipient_query_too_long",
  );
  assert.equal(calls, 0);
});

function createService(unitOfWork: UnitOfWork<UserRepositories>) {
  return new UserService(
    unitOfWork,
    {
      async hash() {
        return { salt: "", hash: new Uint8Array() };
      },
      async verify() {
        return false;
      },
    },
    { now: () => new Date("2026-08-13T00:00:00.000Z") },
    { create: () => TARGET_ID },
  );
}

function actor(role: RecipientActor["role"], sessionVersion: number) {
  return { userId: ACTOR_ID, role, sessionVersion };
}

function user(
  id: string,
  role: UserRecord["role"],
  version: number,
): UserRecord {
  const now = new Date("2026-08-13T00:00:00.000Z");
  return {
    id,
    code: "USR-000001",
    email: "actor@example.test",
    fullName: "Actor User",
    role,
    phone: null,
    emailVerified: true,
    active: true,
    version,
    createdAt: now,
    updatedAt: now,
    deactivatedAt: null,
    deletedAt: null,
  };
}
