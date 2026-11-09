import assert from "node:assert/strict";
import test from "node:test";

import { UserService } from "../lib/application/services/user-service";
import type { TmcOperationUserDto } from "../lib/contracts/tmc-operations";
import type { UserDto } from "../lib/contracts/users";
import { MemoryUserUnitOfWork } from "../lib/server/persistence/memory/memory-user-unit-of-work";
import {
TmcRecipientSearchController,
reconcileTmcUserPickerQuery,
searchEligibleTmcRecipients,
type TmcRecipientSearchState,
} from "../lib/tmc-recipient-search";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

test("recipient search is normalized, active-only, self-excluding, minimal and bounded", () => {
  const users = [
    user(ACTOR_ID, "Demo User 6", "self@example.test", "employee"),
    user("22222222-2222-4222-8222-222222222222", "  Demo Әли 5  ", "demo-ali-5@example.test", "admin"),
    user("33333333-3333-4333-8333-333333333333", "Demo Warehouse", "LOGIN@EXAMPLE.COM", "warehouse"),
    { ...user("44444444-4444-4444-8444-444444444444", "Demo Inactive", "inactive@example.com", "employee"), active: false },
  ];
  for (let index = 0; index < 25; index += 1) {
    users.push(user(uuid(index + 10), `Ali ${String(index).padStart(2, "0")}`, `ali${index}@example.com`, "employee"));
  }

  const byName = searchEligibleTmcRecipients(users, ACTOR_ID, "  ALI  ");
  assert.equal(byName.length, 20);
  assert.equal(byName.some(({ id }) => id === ACTOR_ID), false);
  assert.equal(byName.some(({ id }) => id === "44444444-4444-4444-8444-444444444444"), false);
  assert.deepEqual(Object.keys(byName[0]).sort(), ["email", "fullName", "id", "role"]);
  assert.equal("phone" in byName[0], false);
  assert.equal("code" in byName[0], false);
  assert.equal(byName[0].fullName, "Demo Әли 5");
  assert.deepEqual(
    searchEligibleTmcRecipients(users, ACTOR_ID, "  ӘЛИ  ").map(({ email }) => email),
    ["demo-ali-5@example.test"],
  );

  assert.deepEqual(
    searchEligibleTmcRecipients(users, ACTOR_ID, "login@example").map(({ email }) => email),
    ["LOGIN@EXAMPLE.COM"],
  );
  assert.deepEqual(searchEligibleTmcRecipients(users, ACTOR_ID, "x"), []);
});

test("UserService delegates to a bounded recipient directory that excludes deleted users", async () => {
  const unitOfWork = new MemoryUserUnitOfWork();
  const createdAt = new Date("2026-08-01T00:00:00.000Z");
  await unitOfWork.transaction(async ({ users }) => {
    for (const candidate of [
      { id: ACTOR_ID, email: "self@example.com", fullName: "Self Ali", active: true },
      { id: uuid(2), email: "active@example.com", fullName: "Active Ali", active: true },
      { id: uuid(3), email: "inactive@example.com", fullName: "Inactive Ali", active: false },
      { id: uuid(4), email: "deleted@example.com", fullName: "Deleted Ali", active: true },
    ]) {
      await users.insert({ ...candidate, role: "employee", phone: null, emailVerified: true, createdAt });
    }
    await users.softDelete(uuid(4), 1, new Date("2026-08-02T00:00:00.000Z"));
  });
  const service = new UserService(
    unitOfWork,
    { async hash() { return { salt: "", hash: new Uint8Array() }; }, async verify() { return false; } },
    { now: () => createdAt },
    { create: () => uuid(99) },
  );

  assert.deepEqual(await service.searchTmcRecipients("ALI", {
    userId: ACTOR_ID,
    role: "employee",
    sessionVersion: 1,
  }), [
    { id: uuid(2), fullName: "Active Ali", email: "active@example.com", role: "employee" },
  ]);
  assert.deepEqual(await service.searchTmcRecipients("ALI", {
    userId: ACTOR_ID,
    role: "employee",
    sessionVersion: 1,
  }, { includeSelf: true }), [
    { id: uuid(2), fullName: "Active Ali", email: "active@example.com", role: "employee" },
    { id: ACTOR_ID, fullName: "Self Ali", email: "self@example.com", role: "employee" },
  ]);
});

test("recipient controller debounces queries and rejects stale responses", async () => {
  const scheduler = new ManualScheduler();
  const requests: ControlledRequest[] = [];
  const states: TmcRecipientSearchState[] = [];
  const controller = createController(scheduler, requests, states);

  controller.search("a");
  assert.equal(scheduler.size, 0);
  controller.search("al");
  controller.search("ali");
  assert.equal(scheduler.size, 1);
  scheduler.run();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /q=ali$/);

  controller.search("aliya");
  assert.equal(requests[0].signal.aborted, true);
  scheduler.run();
  assert.equal(requests.length, 2);

  requests[0].resolve(okUsers([option("22222222-2222-4222-8222-222222222222", "Stale")]));
  await Promise.resolve();
  requests[1].resolve(okUsers([option("33333333-3333-4333-8333-333333333333", "Current")]));
  await controller.pending();
  assert.deepEqual(states.at(-1), {
    status: "ready",
    users: [option("33333333-3333-4333-8333-333333333333", "Current")],
  });

  controller.search("next");
  assert.deepEqual(states.at(-1), { status: "loading" });
});

test("controlled picker query follows external values but preserves internal typing clear", () => {
  const first = option(uuid(2), "First User");
  const second = option(uuid(3), "Second User");
  let state = reconcileTmcUserPickerQuery(
    { query: "", valueId: null },
    first,
  );
  assert.deepEqual(state, { query: "First User", valueId: first.id });
  state = reconcileTmcUserPickerQuery(state, second);
  assert.deepEqual(state, { query: "Second User", valueId: second.id });
  state = { query: "typed", valueId: null };
  assert.equal(reconcileTmcUserPickerQuery(state, null), state);
});

test("recipient controller handles malformed and failed responses without stale selection", async () => {
  const scheduler = new ManualScheduler();
  const states: TmcRecipientSearchState[] = [];
  const responses = [
    Promise.resolve({ ok: false, json: async () => ({}) }),
    Promise.resolve({ ok: true, json: async () => ({ users: [{ id: "not-uuid" }] }) }),
    Promise.reject(new Error("offline")),
  ];
  const controller = new TmcRecipientSearchController({
    scheduler,
    fetcher: async () => responses.shift()!,
    onState: (state) => states.push(state),
  });

  for (const query of ["first", "second", "third"]) {
    controller.search(query);
    scheduler.run();
    await controller.pending();
    assert.deepEqual(states.at(-1), { status: "error" });
  }
  controller.dispose();
});

class ManualScheduler {
  private task: (() => void) | null = null;
  get size() { return this.task ? 1 : 0; }
  set(task: () => void) { this.task = task; return 1; }
  clear() { this.task = null; }
  run() { const task = this.task; this.task = null; task?.(); }
}

interface ControlledRequest {
  url: string;
  signal: AbortSignal;
  resolve(response: { ok: boolean; json(): Promise<unknown> }): void;
}

function createController(scheduler: ManualScheduler, requests: ControlledRequest[], states: TmcRecipientSearchState[]) {
  return new TmcRecipientSearchController({
    scheduler,
    fetcher: (url, init) => new Promise((resolve) => requests.push({ url, signal: init.signal, resolve })),
    onState: (state) => states.push(state),
  });
}

function okUsers(users: TmcOperationUserDto[]) { return { ok: true, json: async () => ({ users }) }; }
function option(id: string, fullName: string): TmcOperationUserDto { return { id, fullName, email: `${fullName.toLowerCase()}@example.com`, role: "employee" }; }
function uuid(value: number) { return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`; }
function user(id: string, fullName: string, email: string, role: UserDto["role"]): UserDto {
  return { id, code: `USR-${id.slice(0, 4)}`, fullName, email, phone: "+0 000 000 00 00", role, emailVerified: true, active: true, version: 1, addedAt: "2026-08-01T00:00:00.000Z" };
}
