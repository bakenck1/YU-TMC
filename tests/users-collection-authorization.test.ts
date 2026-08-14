import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { UserService } from "../lib/application/services/user-service";
import { ApplicationError } from "../lib/domain/application-error";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const REJECTED_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_EMAIL = "admin@example.com";

test("GET users rejects a session revoked after the route authorization check", async () => {
  const { service, actor } = await createFixture();
  assert.equal(await service.revokeSessions(ADMIN_EMAIL), true);

  await assert.rejects(service.listUsersForManagement(actor), staleSession);
});

test("POST users rejects a session revoked after the route authorization check", async () => {
  const { service, actor } = await createFixture();
  assert.equal(await service.revokeSessions(ADMIN_EMAIL), true);

  await assert.rejects(
    service.createUser(
      {
        email: "must-not-exist@example.com",
        fullName: "Rejected Replay",
        role: "admin",
        active: true,
        initialPassword: "Rejected-Password-2026!",
      },
      actor.userId,
      actor.sessionVersion,
    ),
    staleSession,
  );
  assert.equal(
    (await service.listUsers()).some(
      (user) => user.email === "must-not-exist@example.com",
    ),
    false,
  );
});

test("users collection route carries the session proof into both service calls", () => {
  const route = readFileSync("app/api/users/route.ts", "utf8");

  assert.match(route, /listUsersForManagement\(actor\)/);
  assert.match(
    route,
    /createUser\([\s\S]*?input,[\s\S]*?actor\.userId,[\s\S]*?actor\.sessionVersion/,
  );
  assert.match(route, /private, no-store, max-age=0, must-revalidate/);
});

async function createFixture() {
  const ids = [ADMIN_ID, TARGET_ID, REJECTED_ID];
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
  await service.createUser(
    {
      email: "target@example.com",
      fullName: "Target User",
      role: "employee",
    },
    actor.userId,
    actor.sessionVersion,
  );
  return { service, actor };
}

function staleSession(error: unknown) {
  return (
    error instanceof ApplicationError &&
    error.kind === "forbidden" &&
    error.publicCode === "forbidden"
  );
}
