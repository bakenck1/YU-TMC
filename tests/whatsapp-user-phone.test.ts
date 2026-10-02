import assert from "node:assert/strict";
import test from "node:test";

import { UserService } from "../lib/application/services/user-service";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";
import { verifyImportedWhatsAppPhone, verifyWhatsAppPhoneForSave } from "../lib/server/whatsapp-user-phone";
import type { YessenovDirectoryEmployee } from "../lib/yessenov-directory";

test("missing gateway configuration never persists a submitted phone; empty numbers clear it", async () => {
  const token = process.env.WA_API_TOKEN;
  try {
    delete process.env.WA_API_TOKEN;
    assert.deepEqual(await verifyWhatsAppPhoneForSave("+7 701 111 22 33"), { phone: undefined, warning: true });
    assert.deepEqual(await verifyWhatsAppPhoneForSave("—"), { phone: null, warning: false });
    assert.deepEqual(await verifyWhatsAppPhoneForSave(undefined), { phone: undefined, warning: false });
  } finally {
    restore("WA_API_TOKEN", token);
  }
});

test("SSO checks new numbers, retains verified phones when claims fail, and keeps login available", async () => {
  await withGateway("phone-sso-test", async (respond, calls) => {
    const service = createService();
    const identity = { subject: "personnel-1", email: "employee@yu.edu.kz", name: "Test Employee", phoneNumber: "+7 701 111 22 33" };
    assert.equal((await service.authenticateYessenovIdentity(identity)).status, "authenticated");
    assert.equal((await service.listUsers())[0].phone, "77011112233");
    assert.equal(calls.length, 1);
    await service.authenticateYessenovIdentity(identity);
    assert.equal(calls.length, 1, "unchanged verified claims do not recheck on login");

    respond(() => Response.json({ ok: true, registered: false }));
    assert.equal((await service.authenticateYessenovIdentity({ ...identity, phoneNumber: "77022223344", name: "Updated Employee" })).status, "authenticated");
    assert.equal((await service.listUsers())[0].phone, "77011112233");
    assert.equal((await service.listUsers())[0].fullName, "Updated Employee");

    respond(() => new Response("{}", { status: 503 }));
    assert.equal((await service.authenticateYessenovIdentity({ ...identity, subject: "personnel-2", email: "other@yu.edu.kz", phoneNumber: "77033334455" })).status, "authenticated");
    assert.equal((await service.listUsers()).find((user) => user.email === "other@yu.edu.kz")?.phone, null);
    const countAfterFailure = calls.length;
    await service.authenticateYessenovIdentity({ ...identity, subject: "personnel-3", email: "third@yu.edu.kz", phoneNumber: "77044445566" });
    assert.equal(calls.length, countAfterFailure, "outage prevents per-person bulk timeouts");
  });
});

test("personnel sync only displays and persists verified numbers and preserves them during an outage", async () => {
  await withGateway("phone-directory-test", async (respond, calls) => {
    let employees = [employee("+7 701 111 22 33")];
    const service = createService({ async listEmployees() { return employees; } });
    await service.registerFirstAdmin({ email: "admin@yu.edu.kz", name: "Local Admin", password: "test-password" });
    const actor = (await service.resolveCurrentAccount("admin@yu.edu.kz"))!;
    const first = await service.listUsersForManagement(actor);
    assert.equal(first.find((user) => user.email === "employee@yu.edu.kz")?.phone, "77011112233");
    const initialCallCount = calls.length;
    await service.listUsersForManagement(actor);
    assert.equal(calls.length, initialCallCount, "unchanged directory phones do not recheck on page loads");

    employees = [employee("")];
    const missing = await service.listUsersForManagement(actor);
    assert.equal(missing.find((user) => user.email === "employee@yu.edu.kz")?.phone, "77011112233");
    assert.equal(calls.length, initialCallCount, "missing directory phones do not erase a saved number");

    employees = [employee("77022223344")];
    respond(() => Response.json({ ok: true, registered: false }));
    const rejected = await service.listUsersForManagement(actor);
    assert.equal(rejected.find((user) => user.email === "employee@yu.edu.kz")?.phone, "77011112233");
    assert.equal((await service.listUsers()).find((user) => user.email === "employee@yu.edu.kz")?.phone, "77011112233");

    employees = [employee("77033334455")];
    respond(() => new Response("{}", { status: 503 }));
    const unavailable = await service.listUsersForManagement(actor);
    assert.equal(unavailable.find((user) => user.email === "employee@yu.edu.kz")?.phone, "77011112233");
  });
});

function createService(directory?: { listEmployees(): Promise<YessenovDirectoryEmployee[]> }) {
  let nextId = 0;
  return new UserService(
    new MemoryUserUnitOfWork(),
    { async hash() { return { salt: "test", hash: new Uint8Array([1]) }; }, async verify() { return false; } },
    { now: () => new Date("2026-10-02T12:00:00Z") },
    { create: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` },
    directory,
    verifyImportedWhatsAppPhone,
  );
}

function employee(phone: string): YessenovDirectoryEmployee {
  return {
    id: 1, personnelId: 1, iin: "000000000001", username: "employee", firstName: "Test", lastName: "Employee",
    middleName: null, fullName: "Test Employee", displayName: "Test Employee", email: "employee@yu.edu.kz",
    phone, image: null, isActive: true, isSuperuser: false, roles: ["personnel"], employedAt: "2025-01-01",
    orgUnit: null, position: null,
  };
}

async function withGateway(
  session: string,
  run: (respond: (response: () => Response) => void, calls: Record<string, unknown>[]) => Promise<void>,
) {
  const token = process.env.WA_API_TOKEN;
  const currentSession = process.env.WA_SESSION;
  const originalFetch = globalThis.fetch;
  const calls: Record<string, unknown>[] = [];
  let response = () => Response.json({ ok: true, registered: true });
  try {
    process.env.WA_API_TOKEN = "test-only";
    process.env.WA_SESSION = session;
    globalThis.fetch = async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response();
    };
    await run((next) => { response = next; }, calls);
    assert.ok(calls.every((call) => !Object.hasOwn(call, "message") && !Object.hasOwn(call, "template")), "phone verification never sends messages");
  } finally {
    globalThis.fetch = originalFetch;
    restore("WA_API_TOKEN", token);
    restore("WA_SESSION", currentSession);
  }
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
