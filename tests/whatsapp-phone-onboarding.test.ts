import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET as listUsers } from "../app/api/users/route";
import { UserService, type CurrentAccount } from "../lib/application/services/user-service";
import { getApplicationServices, resetApplicationServicesForTests, type ApplicationServices } from "../lib/server/application";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";
import { requireCurrentUser } from "../lib/server/security/request-user";
import { createSessionToken, SESSION_COOKIE_NAME } from "../lib/security/session";
import { resetRateLimitStateForTests } from "../lib/security/rate-limiter";

const envKeys = ["NODE_ENV", "YU_INVENTORY_TEST_USER_STORE", "SESSION_SECRET"] as const;
const env: Record<string, string | undefined> = process.env;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
beforeEach(() => {
  env.NODE_ENV = "test";
  process.env.YU_INVENTORY_TEST_USER_STORE = "memory";
  process.env.SESSION_SECRET = "test-onboarding-secret-abcdefghijklmnopqrstuvwxyz0123456789";
  resetApplicationServicesForTests();
  resetRateLimitStateForTests();
  let id = 0;
  const users = new UserService(
    new MemoryUserUnitOfWork(),
    { async hash() { return { salt: "test", hash: new Uint8Array([1]) }; }, async verify() { return false; } },
    { now: () => new Date() },
    { create: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
  );
  (globalThis as typeof globalThis & { __yuInventoryApplication?: ApplicationServices }).__yuInventoryApplication = { users } as ApplicationServices;
});
afterEach(() => {
  resetApplicationServicesForTests();
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete env[key];
    else env[key] = originalEnv[key];
  }
});

for (const environment of ["development", "production", "test", undefined]) {
  test(`phone setup is disabled in ${environment ?? "an unset environment"} and users can access APIs`, async () => {
    const service = getApplicationServices().users;
    await service.registerFirstAdmin({ email: "admin@example.test", name: "Admin", password: "Test-password-2026!" });
    const admin = (await service.resolveCurrentAccount("admin@example.test"))!;
    for (const role of ["employee", "warehouse", "typography"] as const) {
      await service.createUser({ email: `${role}@example.test`, fullName: role, role, active: true, initialPassword: "Test-password-2026!" }, admin.userId, admin.sessionVersion);
    }
    if (environment === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = environment;
    for (const role of ["admin", "employee", "warehouse", "typography"]) {
      const actor = (await service.resolveCurrentAccount(`${role}@example.test`))!;
      assert.equal(actor.whatsappPhoneRequired, false);
      assert.equal((await service.getProfile(actor.userId)).phone, null);
    }
    // Exercise HTTP access with the in-memory test rate limiter.
    env.NODE_ENV = "test";
    for (const role of ["admin", "employee", "warehouse", "typography"]) {
      const actor = (await service.resolveCurrentAccount(`${role}@example.test`))!;
      assert.equal((await requireCurrentUser(request(actor))).userId, actor.userId);
    }
    assert.equal((await listUsers(request(admin))).status, 200);
    const employee = (await service.resolveCurrentAccount("employee@example.test"))!;
    assert.equal((await listUsers(request(employee))).status, 403);
    await service.revokeSessions(employee.email);
    await assert.rejects(requireCurrentUser(request(employee)), /unauthorized/);
    await assert.rejects(requireCurrentUser(new Request("https://inventory.example/api/items")), /unauthorized/);
  });
}

function request(user: CurrentAccount) {
  return new Request("https://inventory.example/api/users", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(user, 3600, user.sessionVersion)}` },
  });
}
