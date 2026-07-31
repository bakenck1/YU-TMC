import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthBootstrapRepository,
  ExternalIdentityRecord,
  ExternalIdentityRepository,
  PasswordCredentialRepository,
  UserRecord,
  UserRepositories,
  UserRepository,
} from "../lib/application/ports/user-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { UserService } from "../lib/application/services/user-service";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";

function record(
  input: Partial<UserRecord> & Pick<UserRecord, "id" | "email" | "role">,
): UserRecord {
  return {
    code: `USR-${input.id}`,
    fullName: "Test User",
    phone: null,
    emailVerified: true,
    active: true,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deactivatedAt: null,
    deletedAt: null,
    ...input,
  };
}

test("Google identity binds an active account and creates a new employee", async () => {
  const active = record({
    id: "active",
    email: "employee@yu.edu.kz",
    role: "employee",
  });
  const blocked = record({
    id: "blocked",
    email: "blocked@yu.edu.kz",
    role: "warehouse",
    active: false,
  });
  const service = serviceWithUsers([active, blocked]);

  assert.deepEqual(
    await service.authenticateGoogleIdentity({
      subject: "google-active",
      email: " Employee@YU.EDU.KZ ",
    }),
    {
      status: "authenticated",
      user: {
        email: "employee@yu.edu.kz",
        name: "Test User",
        role: "employee",
      },
    },
  );
  assert.deepEqual(
    await service.authenticateGoogleIdentity({
      subject: "google-blocked",
      email: "blocked@yu.edu.kz",
    }),
    { status: "blocked" },
  );
  assert.deepEqual(
    await service.authenticateGoogleIdentity({
      subject: "google-unknown",
      email: "unknown@yu.edu.kz",
      name: "New Workspace User",
    }),
    {
      status: "authenticated",
      user: {
        email: "unknown@yu.edu.kz",
        name: "New Workspace User",
        role: "employee",
      },
    },
  );
  assert.equal(
    (
      await service.authenticateGoogleIdentity({
        subject: "google-active",
        email: "renamed@yu.edu.kz",
      })
    ).status,
    "authenticated",
  );
  assert.deepEqual(
    await service.authenticateGoogleIdentity({
      subject: "different-google-account",
      email: "employee@yu.edu.kz",
    }),
    { status: "invalid" },
  );
  assert.deepEqual(
    await service.authenticateGoogleIdentity({
      subject: "off-domain",
      email: "employee@gmail.com",
    }),
    { status: "invalid" },
  );
  assert.deepEqual(
    await service.authenticateGoogleIdentity({
      subject: "invalid-email",
      email: "not-an-email",
    }),
    { status: "invalid" },
  );
});

test("concurrent first Google sign-ins create one user and one binding", async () => {
  const unitOfWork = new MemoryUserUnitOfWork();
  let nextId = 0;
  const service = new UserService(
    unitOfWork,
    {
      async hash() {
        throw new Error("Password hashing is not expected");
      },
      async verify() {
        return false;
      },
    },
    { now: () => new Date("2026-01-02T00:00:00Z") },
    { create: () => `google-user-${++nextId}` },
  );
  const input = {
    subject: "concurrent-google-subject",
    email: "concurrent@yu.edu.kz",
    name: "Concurrent User",
  };

  const results = await Promise.all([
    service.authenticateGoogleIdentity(input),
    service.authenticateGoogleIdentity(input),
  ]);

  assert.deepEqual(
    results.map((result) => result.status),
    ["authenticated", "authenticated"],
  );
  const users = await service.listUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0]?.email, "concurrent@yu.edu.kz");
});

test("administrator can provision an active SSO-only user without a password", async () => {
  const admin = record({
    id: "admin",
    email: "admin@yu.edu.kz",
    role: "admin",
  });
  const records = [admin];
  const service = serviceWithUsers(records);

  const created = await service.createUser(
    {
      fullName: "SSO Employee",
      email: "sso.employee@yu.edu.kz",
      role: "employee",
      emailVerified: true,
      active: true,
    },
    admin.id,
  );

  assert.equal(created.active, true);
  assert.equal(created.email, "sso.employee@yu.edu.kz");
  assert.equal(records.at(-1)?.active, true);
});

function serviceWithUsers(records: UserRecord[]) {
  const identities = new Map<string, ExternalIdentityRecord>();
  const users = {
    async list() {
      return records;
    },
    async findById(id: string) {
      return records.find((user) => user.id === id) ?? null;
    },
    async findByIdForUpdate(id: string) {
      return records.find((user) => user.id === id) ?? null;
    },
    async findByNormalizedEmail(email: string) {
      return records.find((user) => user.email === email) ?? null;
    },
    async findByNormalizedEmailForUpdate(email: string) {
      return records.find((user) => user.email === email) ?? null;
    },
    async insert(input) {
      const created = record({
        ...input,
        code: `USR-${records.length + 1}`,
        version: 1,
        updatedAt: input.createdAt,
        deactivatedAt: input.active ? null : input.createdAt,
        deletedAt: null,
      });
      records.push(created);
      return created;
    },
  } as UserRepository;
  const externalIdentities = {
    async lockProvisioning() {},
    async findUserBySubject(provider, subject) {
      const identity = identities.get(`${provider}:${subject}`);
      return identity
        ? records.find((user) => user.id === identity.userId) ?? null
        : null;
    },
    async findByUser(provider, userId) {
      return (
        [...identities.values()].find(
          (identity) =>
            identity.provider === provider && identity.userId === userId,
        ) ?? null
      );
    },
    async insert(input) {
      identities.set(`${input.provider}:${input.subject}`, input);
    },
  } as ExternalIdentityRepository;
  const credentials = {
    async findByUserId() {
      return null;
    },
    async insert() {},
    async replace() {
      return false;
    },
  } as PasswordCredentialRepository;
  const bootstrap = {
    async isComplete() {
      return true;
    },
    async lockAndRead() {
      return { complete: true };
    },
    async complete() {},
  } as AuthBootstrapRepository;
  const repositories = { users, credentials, externalIdentities, bootstrap };
  const unitOfWork: UnitOfWork<UserRepositories> = {
    async read(work) {
      return work(repositories);
    },
    async transaction(work) {
      return work(repositories);
    },
  };
  return new UserService(
    unitOfWork,
    {
      async hash() {
        throw new Error("Password hashing is not expected");
      },
      async verify() {
        return false;
      },
    },
    { now: () => new Date("2026-01-02T00:00:00Z") },
    { create: () => "sso-user" },
  );
}
