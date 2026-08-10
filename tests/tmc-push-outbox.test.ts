import assert from "node:assert/strict";
import test from "node:test";

import type {
  TmcPushOutboxEventRecord,
  WebPushRepositories,
  WebPushSubscriptionRecord,
} from "../lib/application/ports/web-push-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { WebPushService } from "../lib/application/services/web-push-service";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

test("durable TMC outbox localizes and completes every notification type with a stable delivery key", async () => {
  for (const type of ["tmc_transfer.requested", "tmc_transfer.completed", "tmc_transfer.cancelled", "tmc_transfer.problem", "tmc_transfer.overdue"] as const) {
    const harness = createHarness({ type });
    const result = await harness.service.processTmcPushOutbox(10);
    assert.deepEqual(result, { claimed: 1, completed: 1, retried: 0, deadLettered: 0 });
    assert.equal(harness.completed.length, 1);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]?.topic, EVENT_ID.replaceAll("-", ""));
    const payload = JSON.parse(harness.sent[0]!.payload) as { tag: string; url: string; body: string };
    assert.equal(payload.tag, `tmc-event-${EVENT_ID}`);
    assert.equal(payload.url, `/tmc/transfer-requests/${REQUEST_ID}`);
    assert.ok(payload.body.length > 0);
  }
});

test("durable TMC outbox retries temporary failures and dead-letters the tenth attempt", async () => {
  const harness = createHarness({ type: "tmc_transfer.completed", attempt: 10, fail: true });
  const result = await harness.service.processTmcPushOutbox(10);
  assert.deepEqual(result, { claimed: 1, completed: 0, retried: 0, deadLettered: 1 });
  assert.equal(harness.retried[0]?.deadLetter, true);
  assert.equal(harness.completed.length, 0);
});

function createHarness(options: {
  type: TmcPushOutboxEventRecord["type"];
  attempt?: number;
  fail?: boolean;
}) {
  const event: TmcPushOutboxEventRecord = {
    eventId: EVENT_ID,
    type: options.type,
    requestId: REQUEST_ID,
    safePayload: { itemCount: 2 },
    recipientIds: [USER_ID],
    attempt: options.attempt ?? 1,
  };
  const subscription: WebPushSubscriptionRecord = {
    id: "44444444-4444-4444-8444-444444444444",
    userId: USER_ID,
    endpoint: "https://fcm.googleapis.com/fcm/send/test",
    p256dh: "p256dh",
    auth: "auth",
    expirationTime: null,
    userAgent: null,
    language: "en",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const completed: unknown[] = [];
  const retried: Array<{ deadLetter: boolean }> = [];
  const sent: Array<{ payload: string; topic: string }> = [];
  const repositories: WebPushRepositories = {
    webPushSubscriptions: {
      async lockUserSubscriptions() {}, async upsert() { return subscription; },
      async listByUser() { return [subscription]; }, async deleteOlderThanLimit() {},
      async deleteForUser() {}, async deleteIfUnchanged() {},
    },
    tmcPushOutbox: {
      async claim() { return [event]; },
      async complete(input) { completed.push(input); },
      async retry(input) { retried.push(input); },
      async reserveDelivery() { return "reserved"; },
      async completeDelivery() {},
      async failDelivery() {},
    },
  };
  const unitOfWork: UnitOfWork<WebPushRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new WebPushService(
    unitOfWork,
    { async send(_subscription, payload, _configuration, topic) {
      sent.push({ payload, topic });
      if (options.fail) throw Object.assign(new Error("temporary"), { statusCode: 503 });
    } },
    { publicKey: "public", privateKey: "private", subject: "mailto:security@example.com" },
    { now: () => NOW },
    { create: () => "55555555-5555-4555-8555-555555555555" },
    { error() {} },
    { maxAttempts: 1, async wait() {} },
  );
  return { service, completed, retried, sent };
}
