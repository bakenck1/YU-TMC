import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { pushPermissionError } from "../lib/client-push-subscription";
import { syncExistingPushSubscription } from "../lib/client-push-subscription";
import { syncPushSubscriptionLanguage } from "../lib/client-push-subscription";
import {
  applyInspectionResult,
  firstInspectionRoomId,
} from "../lib/inventory-inspection-selection";

const ROOT = new URL("../", import.meta.url);

test("service worker displays assignment pushes and opens only app-local URLs", async () => {
  const worker = await source("public/sw.js");

  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /registration\.showNotification/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /clients\.openWindow\(targetUrl\)/);
  assert.match(worker, /appClient\.navigate\(targetUrl\)/);
  assert.match(worker, /safeAppPath\(event\.notification\.data\?\.url\)/);
  assert.match(worker, /url\.origin === self\.location\.origin/);
});

test("TMC request push is scheduled once after create and is available to every role", async () => {
  const [route, landing, pushRepository, productionCompose, mobileCompose] = await Promise.all([
    source("app/api/inventory/transfer-requests/route.ts"),
    source("components/TmcLanding.tsx"),
    source("lib/server/persistence/postgres/postgres-web-push-repositories.ts"),
    source("docker-compose.production.yml"),
    source("docker-compose.mobile.yml"),
  ]);
  assert.match(route, /after\(\(\) => services\.push\.notifyTmcTransferRequest\(event\)\)/);
  assert.match(route, /export const maxDuration = 30/);
  assert.match(landing, /PushNotificationControl/);
  assert.match(pushRepository, /u\.role in \('admin', 'warehouse', 'employee'\)/);
  for (const compose of [productionCompose, mobileCompose]) {
    assert.match(compose, /WEB_PUSH_VAPID_PUBLIC_KEY/);
    assert.match(compose, /WEB_PUSH_VAPID_PRIVATE_KEY/);
    assert.match(compose, /WEB_PUSH_VAPID_SUBJECT/);
  }
});

test("subscription lifecycle is authenticated and removed before logout", async () => {
  const [subscriptionRoute, client, authProvider] = await Promise.all([
    source("app/api/push/subscriptions/route.ts"),
    source("lib/client-push-subscription.ts"),
    source("components/AuthProvider.tsx"),
  ]);

  assert.match(subscriptionRoute, /requireCurrentUser\(request\)/);
  assert.match(subscriptionRoute, /authorizationActor\(user\)/);
  assert.match(client, /pushManager\.subscribe\(\{/);
  assert.match(client, /userVisibleOnly: true/);
  assert.match(client, /method: "DELETE"/);
  assert.match(client, /subscription\.unsubscribe\(\)/);
  assert.match(authProvider, /removePushSubscriptionBeforeLogout\(\)/);
});

test("dismissed notification permission remains retryable", async () => {
  const control = await source("components/PushNotificationControl.tsx");

  assert.equal(pushPermissionError("default"), "push_permission_dismissed");
  assert.equal(pushPermissionError("denied"), "push_permission_denied");
  assert.equal(pushPermissionError("granted"), null);
  assert.match(control, /\| "dismissed"/);
  assert.match(control, /disabled=\{busy\}/);
  assert.match(control, /state === "dismissed"/);
});

test("VAPID key rotation removes an incompatible browser subscription", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let unsubscribed = false;
  const subscription = {
    endpoint: "https://fcm.googleapis.com/subscription/old-key",
    options: {
      applicationServerKey: Uint8Array.from({ length: 65 }, () => 1).buffer,
    },
    async unsubscribe() {
      unsubscribed = true;
      return true;
    },
  } as unknown as PushSubscription;
  const registration = {
    pushManager: {
      async getSubscription() {
        return subscription;
      },
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      isSecureContext: true,
      PushManager: class {},
      Notification: class {},
      atob: globalThis.atob,
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        async getRegistration() {
          return registration;
        },
      },
    },
  });
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    return new Response(null, { status: 204 });
  };

  try {
    const newPublicKey = Buffer.alloc(65, 2).toString("base64url");
    assert.equal(await syncExistingPushSubscription(newPublicKey, "ru"), null);
    assert.deepEqual(methods, ["DELETE"]);
    assert.equal(unsubscribed, true);
  } finally {
    restoreGlobal("window", originalWindow);
    restoreGlobal("navigator", originalNavigator);
    globalThis.fetch = originalFetch;
  }
});

test("rapid language changes persist the newest push locale last", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalFetch = globalThis.fetch;
  const languages: string[] = [];
  let releaseFirstLookup!: () => void;
  const firstLookup = new Promise<void>((resolve) => {
    releaseFirstLookup = resolve;
  });
  let releaseFirstRequest!: () => void;
  const firstRequest = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const subscription = {
    endpoint: "https://fcm.googleapis.com/subscription/current",
    toJSON() {
      return {
        endpoint: this.endpoint,
        expirationTime: null,
        keys: { p256dh: "P".repeat(65), auth: "A".repeat(22) },
      };
    },
  } as unknown as PushSubscription;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      isSecureContext: true,
      PushManager: class {},
      Notification: class {},
    },
  });
  let lookupCount = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        async getRegistration() {
          lookupCount += 1;
          if (lookupCount === 1) await firstLookup;
          return {
            pushManager: {
              async getSubscription() {
                return subscription;
              },
            },
          };
        },
      },
    },
  });
  let requestCount = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { language: string };
    languages.push(body.language);
    requestCount += 1;
    if (requestCount === 1) await firstRequest;
    return new Response(null, { status: 204 });
  };

  try {
    const first = syncPushSubscriptionLanguage("kk");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = syncPushSubscriptionLanguage("en");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(lookupCount, 1);
    releaseFirstLookup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(lookupCount, 1);
    assert.deepEqual(languages, ["kk"]);
    releaseFirstRequest();
    await Promise.all([first, second]);
    assert.deepEqual(languages, ["kk", "en"]);
  } finally {
    restoreGlobal("window", originalWindow);
    restoreGlobal("navigator", originalNavigator);
    globalThis.fetch = originalFetch;
  }
});

test("an assigned employee starts with a room from the selected inspection", () => {
  const roomId = firstInspectionRoomId(
    [
      {
        id: "inspection-1",
        rooms: [
          {
            id: "inspection-room-1",
            inspectionId: "inspection-1",
            buildingId: "building-1",
            roomId: "room-1",
            buildingName: "Main",
            buildingAddress: "Campus",
            roomDesignation: "101",
            floorNumber: 1,
            floorLabel: null,
            addedAt: "2026-07-31T10:00:00.000Z",
            inspectedAt: null,
          },
        ],
      },
    ],
    "inspection-1",
  );

  assert.equal(roomId, "room-1");
});

test("recording and revising a result updates inspection progress immediately", () => {
  const inspection = {
    id: "inspection-1",
    name: "August audit",
    technicianId: "employee-1",
    status: "in_progress",
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deadlineAt: "2026-08-31T00:00:00.000Z",
    rooms: [{
      id: "inspection-room-1",
      buildingId: "building-1",
      roomId: "room-1",
      buildingName: "Main",
      buildingAddress: "Campus",
      roomDesignation: "101",
      floorNumber: 1,
      floorLabel: null,
      addedAt: "2026-08-01T00:00:00.000Z",
      inspectedAt: null,
    }],
    items: [{
      inspectionRoomId: "inspection-room-1",
      itemId: "item-1",
      itemName: "Monitor",
      inventoryNumber: "INV-1",
      buildingName: "Main",
      roomDesignation: "101",
    }],
    results: [],
    progress: { checked: 0, total: 1, percent: 0, present: 0, missing: 0, unchecked: 1, comments: 0 },
    displayStatus: "draft",
  } as const;
  const firstResult = {
    id: "result-1",
    inspectionId: inspection.id,
    inspectionRoomId: inspection.rooms[0].id,
    itemId: "item-1",
    itemName: "Monitor",
    inventoryNumber: "INV-1",
    registryRoomIdAtScan: "room-1",
    responsibleIdAtScan: null,
    result: "present",
    comment: null,
    revisionNumber: 1,
    createdAt: "2026-08-02T10:00:00.000Z",
  } as const;
  const afterFirst = applyInspectionResult([inspection], firstResult);
  assert.equal(afterFirst[0]?.rooms[0]?.inspectedAt, firstResult.createdAt);
  assert.equal(afterFirst[0]?.results.length, 1);

  const revised = { ...firstResult, result: "damaged", revisionNumber: 2 } as const;
  const afterRevision = applyInspectionResult(afterFirst, revised);
  assert.equal(afterRevision[0]?.results.length, 1);
  assert.equal(afterRevision[0]?.results[0]?.result, "damaged");
  assert.equal(afterRevision[0]?.results[0]?.revisionNumber, 2);
});

test("assignment data flows from admin selection to notifier after persistence", async () => {
  const [
    manager,
    page,
    route,
    service,
    inspectionRepository,
    pushRepository,
    schemaContract,
    migration,
  ] = await Promise.all([
    source("components/InventoryInspectionsManager.tsx"),
    source("app/(protected)/inventory/inspections/page.tsx"),
    source("app/api/inventory/inspections/route.ts"),
    source("lib/application/services/inventory-inspection-service.ts"),
    source(
      "lib/server/persistence/postgres/postgres-inventory-inspection-repositories.ts",
    ),
    source(
      "lib/server/persistence/postgres/postgres-web-push-repositories.ts",
    ),
    source("lib/db/schema-contract.ts"),
    source("drizzle/20260731104926_lethal_malice.sql"),
  ]);

  assert.match(manager, /technicianId: selectedTechnician/);
  assert.match(manager, /aria-label=\{t\("inspections\.assignee"\)\}/);
  assert.match(manager, /t\("inspections\.scanRoom"\)/);
  assert.match(manager, /selectedInspectionRoom/);
  assert.match(page, /searchParams: Promise/);
  assert.match(page, /initialInspectionId/);
  assert.match(route, /technicianId/);
  assert.match(service, /findAssignableTechnician\(technicianId\)/);
  assert.doesNotMatch(service, /assignmentNotifier/);
  assert.match(route, /after\(\(\) =>/);
  assert.match(route, /services\.push\.notifyInspectionAssignment/);
  assert.match(route, /export const maxDuration = 30/);
  assert.match(inspectionRepository, /and is_active = true/);
  assert.match(inspectionRepository, /for share/);
  assert.doesNotMatch(inspectionRepository, /and active = true/);
  assert.match(pushRepository, /join \$\{USERS\} u on u\.id = s\.user_id/);
  assert.match(pushRepository, /and u\.is_active = true/);
  assert.match(
    pushRepository,
    /delete from \$\{SUBSCRIPTIONS\}\s+where user_id = \$1\s+and id in/,
  );
  assert.match(pushRepository, /and p256dh = \$4/);
  assert.match(pushRepository, /and auth = \$5/);
  assert.match(pushRepository, /expiration_time is not distinct from \$6/);
  assert.match(schemaContract, /grant select, insert, update on all tables/);
  assert.match(
    schemaContract,
    /grant delete on table\s+"yu_inventory"\."web_push_subscriptions"/,
  );
  assert.match(migration, /CREATE TABLE "yu_inventory"\."web_push_subscriptions"/);
  assert.match(migration, /web_push_subscriptions_endpoint_unique/);
});

async function source(relativePath: string) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

function restoreGlobal(
  name: "window" | "navigator",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
}
