import assert from "node:assert/strict";
import test from "node:test";

import { createTmcHistoryGetHandler, createTmcNotificationReadPostHandler, createTmcNotificationsGetHandler } from "../lib/server/http/tmc-stage-four-handlers";

const ACTOR = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "employee" as const,
  sessionVersion: 7,
};

test("history GET parses an allowlisted filter set and rejects parameter pollution", async () => {
  const calls: unknown[][] = [];
  const handler = createTmcHistoryGetHandler({
    authenticate: async () => ACTOR,
    listHistory: async (...args) => { calls.push(args); return { requests: [], locationChanges: [], nextRequestCursor: null, nextLocationCursor: null }; },
  });
  const response = await handler(new Request("https://inventory.example/api/inventory/transfer-requests?status=pending&overdue=true&limit=10"));
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0, must-revalidate",
  );
  assert.deepEqual(calls, [[{ status: "pending", overdue: true, limit: 10 }, ACTOR]]);
  for (const query of ["status=pending&status=accepted", "actorId=x", "overdue=1", "limit=999"]) {
    assert.equal((await handler(new Request(`https://inventory.example/api/inventory/transfer-requests?${query}`))).status, 400);
  }
  assert.equal(calls.length, 1);
});

test("history GET keeps private error responses and forwards only safe retry timing", async () => {
  const outcomes: unknown[] = [
    new (await import("../lib/domain/application-error")).ApplicationError(
      "rate_limited",
      "too_many_requests",
      { safeDetails: { retryAfterSeconds: "9" } },
    ),
    new (await import("../lib/domain/application-error")).ApplicationError(
      "rate_limited",
      "too_many_requests",
      { safeDetails: { retryAfterSeconds: "\r\nunsafe" } },
    ),
    new Error("database secret"),
  ];
  const handler = createTmcHistoryGetHandler({
    authenticate: async () => {
      throw outcomes.shift();
    },
    listHistory: async () => {
      throw new Error("must_not_run");
    },
  });

  const limited = await handler(new Request("https://inventory.example/api/inventory/transfer-requests"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "9");
  assert.match(limited.headers.get("cache-control") ?? "", /private/);
  assert.match(limited.headers.get("cache-control") ?? "", /no-store/);

  const unsafe = await handler(new Request("https://inventory.example/api/inventory/transfer-requests"));
  assert.equal(unsafe.status, 429);
  assert.equal(unsafe.headers.get("retry-after"), null);

  const unavailable = await handler(new Request("https://inventory.example/api/inventory/transfer-requests"));
  assert.equal(unavailable.status, 500);
  assert.deepEqual(await unavailable.json(), { error: "internal_error" });
  assert.match(unavailable.headers.get("cache-control") ?? "", /no-store/);
});

test("notification routes enforce bounded feed size and bodyless read command", async () => {
  let reads = 0;
  const get = createTmcNotificationsGetHandler({
    authenticate: async () => ACTOR,
    listNotifications: async (_actor, limit) => ({ notifications: [], unreadCount: limit }),
  });
  assert.deepEqual(await (await get(new Request("https://inventory.example/api/inventory/notifications?limit=50"))).json(), { notifications: [], unreadCount: 50 });
  assert.equal((await get(new Request("https://inventory.example/api/inventory/notifications?limit=51"))).status, 400);
  const post = createTmcNotificationReadPostHandler({
    authenticate: async () => ACTOR,
    markRead: async () => { reads += 1; },
  });
  assert.equal((await post(new Request("https://inventory.example/read", { method: "POST" }), "33333333-3333-4333-8333-333333333333")).status, 204);
  assert.equal((await post(new Request("https://inventory.example/read", { method: "POST", body: "{}" }), "33333333-3333-4333-8333-333333333333")).status, 400);
  assert.equal(reads, 1);
});
