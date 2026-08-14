import assert from "node:assert/strict";
import test from "node:test";

import type {
  UpsertWebPushSubscriptionRecord,
  WebPushRepositories,
  WebPushSubscriptionRecord,
  WebPushSubscriptionRepository,
} from "../lib/application/ports/web-push-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import {
  WebPushService,
  type WebPushSender,
} from "../lib/application/services/web-push-service";
import { ApplicationError } from "../lib/domain/application-error";
import { readWebPushConfiguration } from "../lib/server/web-push-configuration";

const NOW = new Date("2026-07-31T10:00:00.000Z");
const CONFIGURATION = {
  publicKey: "A".repeat(87),
  privateKey: "B".repeat(43),
  subject: "mailto:inventory-admin@yu.edu.kz",
};
const EMPLOYEE = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "employee" as const,
};
const OTHER_EMPLOYEE = {
  userId: "33333333-3333-4333-8333-333333333333",
  role: "employee" as const,
};

test("binds a browser subscription to the authenticated account", async () => {
  const fixture = createFixture();
  const forgedInputOwner = {
    endpoint: "https://fcm.googleapis.com/subscription/1",
    expirationTime: null,
    keys: {
      p256dh: "P".repeat(65),
      auth: "A".repeat(22),
    },
    language: "en",
    userId: OTHER_EMPLOYEE.userId,
  };

  await fixture.service.subscribe(
    forgedInputOwner,
    EMPLOYEE,
    "Mobile Browser",
  );

  const stored = [...fixture.records.values()];
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.userId, EMPLOYEE.userId);
  assert.equal(stored[0]?.userAgent, "Mobile Browser");
  assert.equal(stored[0]?.language, "en");
  assert.deepEqual(fixture.service.publicConfiguration(), {
    configured: true,
    publicKey: CONFIGURATION.publicKey,
  });
});

test("another account cannot rebind or remove an owned push endpoint", async () => {
  const fixture = createFixture();
  const ownerInput = fixture.subscriptionInput("owned");
  const attackerInput = {
    ...ownerInput,
    keys: {
      p256dh: "Q".repeat(65),
      auth: "B".repeat(22),
    },
    language: "en" as const,
  };

  await fixture.service.subscribe(ownerInput, EMPLOYEE, "Owner browser");
  await assert.rejects(
    fixture.service.subscribe(attackerInput, OTHER_EMPLOYEE, "Attacker browser"),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "conflict" &&
      error.publicCode === "push_subscription_conflict",
  );

  const stored = fixture.records.get(ownerInput.endpoint);
  assert.equal(stored?.userId, EMPLOYEE.userId);
  assert.equal(stored?.p256dh, "P".repeat(65));
  assert.equal(stored?.auth, "A".repeat(22));
  assert.equal(stored?.language, "ru");
  assert.equal(stored?.userAgent, "Owner browser");

  await fixture.service.unsubscribe(ownerInput.endpoint, OTHER_EMPLOYEE);
  assert.equal(fixture.records.has(ownerInput.endpoint), true);

  await fixture.service.unsubscribe(ownerInput.endpoint, EMPLOYEE);
  assert.equal(fixture.records.has(ownerInput.endpoint), false);
});

test("concurrent accounts cannot both claim the same push endpoint", async () => {
  const fixture = createFixture();
  const input = fixture.subscriptionInput("raced");

  const results = await Promise.allSettled([
    fixture.service.subscribe(input, EMPLOYEE, null),
    fixture.service.subscribe(input, OTHER_EMPLOYEE, null),
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof ApplicationError);
  assert.equal(rejected.reason.kind, "conflict");
  assert.equal(rejected.reason.publicCode, "push_subscription_conflict");
  assert.equal(fixture.records.size, 1);
});

test("serializes subscription updates and retains at most ten devices", async () => {
  const fixture = createFixture();

  for (let index = 0; index < 11; index += 1) {
    await fixture.service.subscribe(
      fixture.subscriptionInput(`device-${index}`),
      EMPLOYEE,
      null,
    );
  }

  assert.equal(fixture.records.size, 10);
  assert.equal(fixture.locks.length, 11);
  assert.ok(fixture.locks.every((userId) => userId === EMPLOYEE.userId));
});

test("rejects non-HTTPS or malformed subscription input", async () => {
  const fixture = createFixture();

  await assert.rejects(
    fixture.service.subscribe(
      {
        endpoint: "http://127.0.0.1/internal",
        keys: { p256dh: "short", auth: "short" },
      },
      EMPLOYEE,
      null,
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "validation" &&
      error.message === "invalid_push_subscription",
  );
  await assert.rejects(
    fixture.service.subscribe(
      {
        endpoint: "https://metadata.internal.example/push",
        keys: { p256dh: "P".repeat(65), auth: "A".repeat(22) },
      },
      EMPLOYEE,
      null,
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "validation" &&
      error.message === "invalid_push_subscription",
  );
  for (const aliasSuffix of ["#foreign-owner", "#", "?"]) {
    await assert.rejects(
      fixture.service.subscribe(
        {
          ...fixture.subscriptionInput("url-alias"),
          endpoint: `${fixture.endpoint("url-alias")}${aliasSuffix}`,
        },
        EMPLOYEE,
        null,
      ),
      (error) =>
        error instanceof ApplicationError &&
        error.kind === "validation" &&
        error.message === "invalid_push_subscription",
    );
  }
});

test("delivers assignment payload and prunes expired push endpoints", async () => {
  const fixture = createFixture();
  fixture.addSubscription("active", null);
  fixture.addSubscription("gone", null);
  fixture.addSubscription("temporary", null);
  fixture.addSubscription("kazakh", null, "kk");
  fixture.addSubscription(
    "expired",
    new Date("2026-07-31T09:59:59.000Z"),
  );
  const payloads: Array<{ endpoint: string; payload: string; topic: string }> = [];
  fixture.sender.send = async (subscription, payload, _configuration, topic) => {
    payloads.push({ endpoint: subscription.endpoint, payload, topic });
    if (subscription.endpoint.endsWith("/gone")) {
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    }
    if (subscription.endpoint.endsWith("/temporary")) {
      throw Object.assign(new Error("timeout"), { statusCode: 503 });
    }
  };

  await fixture.service.notifyInspectionAssignment({
    inspectionId: "22222222-2222-4222-8222-222222222222",
    inspectionName: "Technopark — July",
    technicianId: EMPLOYEE.userId,
  });

  assert.equal(payloads.length, 6);
  assert.equal(
    payloads.filter(({ endpoint }) => endpoint.endsWith("/temporary")).length,
    3,
  );
  const payload = JSON.parse(payloads[0]!.payload) as {
    title: string;
    body: string;
    url: string;
  };
  assert.equal(payload.title, "Новая инвентаризация");
  assert.match(payload.body, /Technopark — July/);
  const kazakhPayload = JSON.parse(
    payloads.find(({ endpoint }) => endpoint.endsWith("/kazakh"))!.payload,
  ) as { title: string; body: string };
  assert.equal(kazakhPayload.title, "Жаңа түгендеу");
  assert.equal(kazakhPayload.body, "Сізге «Technopark — July» тағайындалды");
  assert.equal(
    payload.url,
    "/inventory/inspections?inspection=22222222-2222-4222-8222-222222222222",
  );
  assert.equal(payloads[0]?.topic.length, 32);
  assert.equal(fixture.records.has(fixture.endpoint("gone")), false);
  assert.equal(fixture.records.has(fixture.endpoint("expired")), false);
  assert.equal(fixture.records.has(fixture.endpoint("temporary")), true);
  assert.equal(fixture.records.has(fixture.endpoint("active")), true);
  assert.equal(fixture.waits.length, 2);
  assert.ok(
    fixture.logs.some(({ event }) => event === "push_assignment_delivery_failed"),
  );
  assert.ok(
    fixture.logs.some(
      ({ event }) => event === "push_assignment_delivery_incomplete",
    ),
  );
});

test("delivers one localized aggregate TMC request push with an exact deep link", async () => {
  const fixture = createFixture();
  fixture.addSubscription("russian", null, "ru");
  fixture.addSubscription("kazakh", null, "kk");
  fixture.addSubscription("english", null, "en");
  const payloads: Array<{ payload: string; topic: string }> = [];
  fixture.sender.send = async (_subscription, payload, _configuration, topic) => {
    payloads.push({ payload, topic });
  };
  const requestId = "22222222-2222-4222-8222-222222222222";

  await fixture.service.notifyTmcTransferRequest({
    requestId,
    recipientId: EMPLOYEE.userId,
    itemCount: 17,
  });

  assert.equal(payloads.length, 3);
  for (const { payload, topic } of payloads) {
    const parsed = JSON.parse(payload) as { title: string; body: string; url: string; tag: string };
    assert.equal(parsed.url, `/tmc/transfer-requests/${requestId}`);
    assert.match(parsed.body, /17/);
    assert.equal(parsed.tag, `tmc-transfer-${requestId}`);
    assert.equal(topic, requestId.replaceAll("-", "").slice(0, 32));
    assert.doesNotMatch(payload, /comment|cost|price|email/i);
  }
  assert.equal(new Set(payloads.map(({ payload }) => JSON.parse(payload).title)).size, 3);
});

test("TMC push uses retry and stale subscription cleanup without failing the request", async () => {
  const fixture = createFixture();
  fixture.addSubscription("gone-tmc", null);
  fixture.addSubscription("temporary-tmc", null);
  fixture.addSubscription("expired-tmc", new Date(NOW.getTime() - 1));
  fixture.sender.send = async (subscription) => {
    if (subscription.endpoint.endsWith("gone-tmc")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (subscription.endpoint.endsWith("temporary-tmc")) throw Object.assign(new Error("retry"), { statusCode: 503 });
  };
  await fixture.service.notifyTmcTransferRequest({ requestId: "22222222-2222-4222-8222-222222222222", recipientId: EMPLOYEE.userId, itemCount: 1 });
  assert.equal(fixture.records.has(fixture.endpoint("gone-tmc")), false);
  assert.equal(fixture.records.has(fixture.endpoint("expired-tmc")), false);
  assert.equal(fixture.records.has(fixture.endpoint("temporary-tmc")), true);
  assert.deepEqual(fixture.waits, [1, 2]);
});

test("TMC push is a no-op without VAPID and does not retry permanent failures", async () => {
  const unconfigured = createFixture(null);
  unconfigured.addSubscription("unconfigured-tmc", null);
  await unconfigured.service.notifyTmcTransferRequest({ requestId: "22222222-2222-4222-8222-222222222222", recipientId: EMPLOYEE.userId, itemCount: 1 });
  assert.deepEqual(unconfigured.sent, []);

  const fixture = createFixture();
  fixture.addSubscription("permanent-tmc", null);
  fixture.sender.send = async () => { throw Object.assign(new Error("forbidden"), { statusCode: 403 }); };
  await fixture.service.notifyTmcTransferRequest({ requestId: "22222222-2222-4222-8222-222222222222", recipientId: EMPLOYEE.userId, itemCount: 1 });
  assert.deepEqual(fixture.waits, []);
  assert.ok(fixture.logs.some(({ event }) => event === "push_tmc_delivery_failed"));
});

test("TMC subscription lookup failure is isolated from the committed request", async () => {
  const fixture = createFixture();
  fixture.repository.listByUser = async () => { throw new Error("database unavailable"); };
  await fixture.service.notifyTmcTransferRequest({ requestId: "22222222-2222-4222-8222-222222222222", recipientId: EMPLOYEE.userId, itemCount: 1 });
  assert.deepEqual(fixture.sent, []);
  assert.ok(fixture.logs.some(({ event }) => event === "push_tmc_subscription_lookup_failed"));
});

test("stale cleanup preserves an endpoint reassigned during delivery", async () => {
  const fixture = createFixture();
  fixture.addSubscription("reassigned", null);
  const endpoint = fixture.endpoint("reassigned");
  fixture.sender.send = async (subscription) => {
    const previous = fixture.records.get(subscription.endpoint)!;
    fixture.records.set(subscription.endpoint, {
      ...previous,
      userId: OTHER_EMPLOYEE.userId,
      updatedAt: new Date(NOW.getTime() + 1_000),
    });
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  };

  await fixture.service.notifyInspectionAssignment({
    inspectionId: "22222222-2222-4222-8222-222222222222",
    inspectionName: "Race check",
    technicianId: EMPLOYEE.userId,
  });

  assert.equal(fixture.records.get(endpoint)?.userId, OTHER_EMPLOYEE.userId);
});

test("stale cleanup preserves refreshed keys with the same timestamp", async () => {
  const fixture = createFixture();
  fixture.addSubscription("refreshed", null);
  const endpoint = fixture.endpoint("refreshed");
  fixture.sender.send = async (subscription) => {
    const previous = fixture.records.get(subscription.endpoint)!;
    fixture.records.set(subscription.endpoint, {
      ...previous,
      auth: "N".repeat(22),
    });
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  };

  await fixture.service.notifyInspectionAssignment({
    inspectionId: "22222222-2222-4222-8222-222222222222",
    inspectionName: "Refresh race",
    technicianId: EMPLOYEE.userId,
  });

  assert.equal(fixture.records.get(endpoint)?.auth, "N".repeat(22));
});

test("stale cleanup preserves a same-timestamp language refresh", async () => {
  const fixture = createFixture();
  fixture.addSubscription("locale-refresh", null, "ru");
  const endpoint = fixture.endpoint("locale-refresh");
  fixture.sender.send = async (subscription) => {
    const previous = fixture.records.get(subscription.endpoint)!;
    fixture.records.set(subscription.endpoint, {
      ...previous,
      language: "en",
    });
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  };

  await fixture.service.notifyInspectionAssignment({
    inspectionId: "22222222-2222-4222-8222-222222222222",
    inspectionName: "Locale race",
    technicianId: EMPLOYEE.userId,
  });

  assert.equal(fixture.records.get(endpoint)?.language, "en");
});

test("does not attempt delivery when VAPID is not configured", async () => {
  const fixture = createFixture(null);
  fixture.addSubscription("active", null);

  await fixture.service.notifyInspectionAssignment({
    inspectionId: "22222222-2222-4222-8222-222222222222",
    inspectionName: "Check",
    technicianId: EMPLOYEE.userId,
  });

  assert.equal(fixture.sent.length, 0);
  assert.deepEqual(fixture.service.publicConfiguration(), {
    configured: false,
    publicKey: null,
  });
});

test("accepts only complete valid VAPID configuration", () => {
  const publicKey = Buffer.alloc(65, 1).toString("base64url");
  const privateKey = Buffer.alloc(32, 2).toString("base64url");
  const complete = {
    WEB_PUSH_VAPID_PUBLIC_KEY: publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: privateKey,
    WEB_PUSH_VAPID_SUBJECT: "mailto:inventory@example.com",
  };

  assert.deepEqual(readWebPushConfiguration(complete), {
    publicKey,
    privateKey,
    subject: complete.WEB_PUSH_VAPID_SUBJECT,
  });
  assert.equal(
    readWebPushConfiguration({
      WEB_PUSH_VAPID_PUBLIC_KEY: publicKey,
    }),
    null,
  );
  assert.equal(
    readWebPushConfiguration({
      ...complete,
      WEB_PUSH_VAPID_PRIVATE_KEY: "invalid",
    }),
    null,
  );
});

function createFixture(
  configuration: typeof CONFIGURATION | null = CONFIGURATION,
) {
  const records = new Map<string, WebPushSubscriptionRecord>();
  const locks: string[] = [];
  const repository: WebPushSubscriptionRepository = {
    async lockUserSubscriptions(userId) {
      locks.push(userId);
    },
    async upsert(input) {
      const existing = records.get(input.endpoint);
      if (existing && existing.userId !== input.userId) return null;
      const value = toRecord(input, existing);
      records.set(value.endpoint, value);
      return value;
    },
    async listByUser(userId) {
      return [...records.values()].filter((record) => record.userId === userId);
    },
    async deleteOlderThanLimit(userId, keep) {
      const owned = [...records.values()]
        .filter((record) => record.userId === userId)
        .sort(
          (left, right) =>
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            right.id.localeCompare(left.id),
        );
      owned.slice(keep).forEach((record) => records.delete(record.endpoint));
    },
    async deleteForUser(userId, endpoint) {
      if (records.get(endpoint)?.userId === userId) records.delete(endpoint);
    },
    async deleteIfUnchanged(subscription) {
      const current = records.get(subscription.endpoint);
      if (
        current?.id === subscription.id &&
        current.userId === subscription.userId &&
        current.p256dh === subscription.p256dh &&
        current.auth === subscription.auth &&
        current.expirationTime?.getTime() ===
          subscription.expirationTime?.getTime() &&
        current.language === subscription.language &&
        current.updatedAt.getTime() === subscription.updatedAt.getTime()
      ) {
        records.delete(subscription.endpoint);
      }
    },
  };
  const repositories = {
    webPushSubscriptions: repository,
  } satisfies WebPushRepositories;
  const unitOfWork: UnitOfWork<WebPushRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const sent: string[] = [];
  const logs: Array<{
    event: string;
    context: Record<string, string | number | undefined>;
  }> = [];
  const waits: number[] = [];
  const sender: WebPushSender = {
    async send(subscription) {
      sent.push(subscription.endpoint);
    },
  };
  let id = 0;
  const service = new WebPushService(
    unitOfWork,
    sender,
    configuration,
    { now: () => NOW },
    { create: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
    {
      error(event, context) {
        logs.push({ event, context });
      },
    },
    {
      maxAttempts: 3,
      async wait(attempt) {
        waits.push(attempt);
      },
    },
  );
  const endpoint = (suffix: string) =>
    `https://fcm.googleapis.com/subscription/${suffix}`;

  return {
    records,
    repository,
    locks,
    logs,
    sender,
    sent,
    service,
    waits,
    endpoint,
    subscriptionInput(suffix: string) {
      return {
        endpoint: endpoint(suffix),
        expirationTime: null,
        keys: {
          p256dh: "P".repeat(65),
          auth: "A".repeat(22),
        },
      };
    },
    addSubscription(
      suffix: string,
      expirationTime: Date | null,
      language: "ru" | "kk" | "en" = "ru",
    ) {
      const value: WebPushSubscriptionRecord = {
        id: `subscription-${suffix}`,
        userId: EMPLOYEE.userId,
        endpoint: endpoint(suffix),
        p256dh: "P".repeat(65),
        auth: "A".repeat(22),
        expirationTime,
        userAgent: null,
        language,
        createdAt: NOW,
        updatedAt: NOW,
      };
      records.set(value.endpoint, value);
    },
  };
}

function toRecord(
  input: UpsertWebPushSubscriptionRecord,
  existing?: WebPushSubscriptionRecord,
): WebPushSubscriptionRecord {
  return {
    id: existing?.id ?? input.id,
    userId: input.userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    expirationTime: input.expirationTime,
    userAgent: input.userAgent,
    language: input.language,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}
