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

  await fixture.service.subscribe(
    {
      endpoint: "https://fcm.googleapis.com/subscription/1",
      expirationTime: null,
      keys: {
        p256dh: "P".repeat(65),
        auth: "A".repeat(22),
      },
      language: "en",
    },
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

test("endpoint ownership moves on sign-in and only its current owner can remove it", async () => {
  const fixture = createFixture();
  const input = fixture.subscriptionInput("shared");

  await fixture.service.subscribe(input, EMPLOYEE, null);
  await fixture.service.subscribe(input, OTHER_EMPLOYEE, null);
  await fixture.service.unsubscribe(input.endpoint, EMPLOYEE);

  assert.equal(fixture.records.get(input.endpoint)?.userId, OTHER_EMPLOYEE.userId);

  await fixture.service.unsubscribe(input.endpoint, OTHER_EMPLOYEE);
  assert.equal(fixture.records.has(input.endpoint), false);
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
