import assert from "node:assert/strict";
import test from "node:test";

import type { UserDto } from "../lib/contracts/users";
import { ApplicationError } from "../lib/domain/application-error";
import { UserService } from "../lib/application/services/user-service";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_EMAIL = "admin@example.com";

test("PATCH user rejects a session revoked after the route authorization check", async () => {
  const { service, actor, target } = await createFixture();
  assert.equal(await service.revokeSessions(ADMIN_EMAIL), true);

  await assert.rejects(
    service.updateUser(
      target.id,
      updateInput(target),
      actor.userId,
      actor.sessionVersion,
    ),
    staleSession,
  );
  assert.equal((await service.getProfile(target.id)).fullName, target.fullName);
});

test("DELETE user rejects a session revoked after the route authorization check", async () => {
  const { service, actor, target } = await createFixture();
  assert.equal(await service.revokeSessions(ADMIN_EMAIL), true);

  await assert.rejects(
    service.deleteUser(
      target.id,
      target.version,
      actor.userId,
      actor.sessionVersion,
    ),
    staleSession,
  );
  assert.equal((await service.getProfile(target.id)).id, target.id);
});

async function createFixture() {
  const ids = [ADMIN_ID, TARGET_ID];
  const service = new UserService(
    new MemoryUserUnitOfWork(),
    {
      async hash() {
        return { salt: "test-salt", hash: new Uint8Array([1]) };
      },
      async verify() {
        return false;
      },
    },
    { now: () => new Date("2026-08-14T00:00:00.000Z") },
    { create: () => ids.shift()! },
  );
  await service.registerFirstAdmin({
    email: ADMIN_EMAIL,
    name: "Administrator",
    password: "Test-Password-2026!",
  });
  const actor = (await service.resolveCurrentAccount(ADMIN_EMAIL))!;
  const target = await service.createUser(
    {
      email: "target@example.com",
      fullName: "Target User",
      role: "employee",
      active: true,
      initialPassword: "Target-Password-2026!",
    },
    actor.userId,
    actor.sessionVersion,
  );
  return { service, actor, target };
}

function updateInput(user: UserDto) {
  return {
    fullName: "Unauthorized overwrite",
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified,
    active: user.active,
    version: user.version,
  };
}

function staleSession(error: unknown) {
  return (
    error instanceof ApplicationError &&
    error.kind === "forbidden" &&
    error.publicCode === "forbidden"
  );
}
