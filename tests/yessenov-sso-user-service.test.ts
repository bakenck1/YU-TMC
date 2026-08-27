import assert from "node:assert/strict";
import test from "node:test";

import { UserService } from "../lib/application/services/user-service";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";

function createService() {
  let nextId = 0;
  return new UserService(
    new MemoryUserUnitOfWork(),
    {
      async hash() {
        throw new Error("Password hashing is not expected");
      },
      async verify() {
        return false;
      },
    },
    { now: () => new Date("2026-08-27T12:00:00Z") },
    { create: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` },
  );
}

test("Yessenov ID creates a first-login employee and binds the provider subject", async () => {
  const service = createService();
  const first = await service.authenticateYessenovIdentity({
    subject: "personnel-123",
    email: " Employee@YU.EDU.KZ ",
    name: "Employee Name",
    iin: "123456789012",
  });
  assert.deepEqual(first, {
    status: "authenticated",
    sessionVersion: 1,
    user: {
      email: "employee@yu.edu.kz",
      name: "Employee Name",
      role: "employee",
    },
  });
  assert.equal((await service.listUsers()).length, 1);
  assert.equal((await service.listUsers())[0]?.iin, null);

  const later = await service.authenticateYessenovIdentity({
    subject: "personnel-123",
    email: "renamed@yu.edu.kz",
    name: "Renamed Employee",
  });
  assert.equal(later.status, "authenticated");
  assert.equal((await service.listUsers()).length, 1);
});

test("concurrent Yessenov first logins create only one employee", async () => {
  const service = createService();
  const identity = {
    subject: "personnel-concurrent",
    email: "concurrent@yu.edu.kz",
    name: "Concurrent Employee",
  };
  const outcomes = await Promise.all([
    service.authenticateYessenovIdentity(identity),
    service.authenticateYessenovIdentity(identity),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), [
    "authenticated",
    "authenticated",
  ]);
  assert.equal((await service.listUsers()).length, 1);
});

test("Yessenov auto-provisioning rejects non-corporate and malformed profiles", async () => {
  const service = createService();
  assert.deepEqual(
    await service.authenticateYessenovIdentity({
      subject: "outside",
      email: "employee@example.com",
      name: "Outside Employee",
    }),
    { status: "invalid" },
  );
  assert.deepEqual(
    await service.authenticateYessenovIdentity({
      subject: "bad-name",
      email: "employee@yu.edu.kz",
      name: "x",
    }),
    { status: "invalid" },
  );
});
