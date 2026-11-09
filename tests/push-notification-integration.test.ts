import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import type { ItemResultDto } from "../lib/contracts/inventory-inspection-results";
import type { InspectionDto } from "../lib/contracts/inventory-inspections";

import { pushPermissionError,syncExistingPushSubscription,syncPushSubscriptionLanguage } from "../lib/client-push-subscription";
import {
applyInspectionResult,
firstInspectionRoomId,
} from "../lib/inventory-inspection-selection";

const ROOT = new URL("../", import.meta.url);

test("service worker keeps TMC deep links local and reuses an open app window", async () => {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const focused: string[] = [];
  const worker = {
    location: { origin: "https://inventory.test" },
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      listeners.set(type, listener);
    },
    registration: {
      async showNotification(title: string, options: Record<string, unknown>) { shown.push({ title, options }); },
    },
    clients: {
      async matchAll() {
        return [{
          url: "https://inventory.test/tmc",
          async navigate(url: string) { navigated.push(url); return { async focus() { focused.push(url); } }; },
        }];
      },
      async openWindow(url: string) { opened.push(url); },
      async claim() {},
    },
  };
  vm.runInNewContext(await source("public/sw.js"), { self: worker, URL, Promise });
  assert.equal(listeners.has("fetch"), false);
  const pending: Promise<unknown>[] = [];
  listeners.get("push")!({
    data: { json: () => ({ title: "TMC", body: "1", url: "/tmc/transfer-requests/abc" }) },
    waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  });
  await Promise.all(pending.splice(0));
  assert.equal(shown[0]?.options.data && (shown[0].options.data as { url: string }).url, "/tmc/transfer-requests/abc");
  listeners.get("notificationclick")!({
    notification: { close() {}, data: { url: "//evil.test/steal" } },
    waitUntil(promise: Promise<unknown>) { pending.push(promise); },
  });
  await Promise.all(pending);
  assert.deepEqual(navigated, ["https://inventory.test/"]);
  assert.deepEqual(focused, ["https://inventory.test/"]);
  assert.deepEqual(opened, []);
});

test("service worker opens the exact TMC card for focus, navigate, and navigation fallback paths", async () => {
  const target = "https://inventory.test/tmc/transfer-requests/abc";
  const exactClient = {
    url: target,
    async focus() { this.focused.push(target); },
    focused: [] as string[],
  };
  const exact = await clickWorker("/tmc/transfer-requests/abc", [exactClient]);
  assert.deepEqual((exact.clients[0] as { focused: string[] }).focused, [target]);
  assert.deepEqual(exact.opened, []);

  const navigatedClient = {
    url: "https://inventory.test/tmc",
    async navigate(url: string) { this.navigated.push(url); return { focus: async () => this.focused.push(url) }; },
    navigated: [] as string[],
    focused: [] as string[],
  };
  const navigated = await clickWorker("/tmc/transfer-requests/abc", [navigatedClient]);
  assert.deepEqual((navigated.clients[0] as { navigated: string[] }).navigated, [target]);
  assert.deepEqual((navigated.clients[0] as { focused: string[] }).focused, [target]);
  assert.deepEqual(navigated.opened, []);

  for (const outcome of ["null", "reject"] as const) {
    const fallback = await clickWorker("/tmc/transfer-requests/abc", [{
      url: "https://inventory.test/tmc",
      async navigate() {
        if (outcome === "reject") throw new Error("navigation failed");
        return null;
      },
    }]);
    assert.deepEqual(fallback.opened, [target]);
  }
  const noClient = await clickWorker("/tmc/transfer-requests/abc", []);
  assert.deepEqual(noClient.opened, [target]);
});

test("dismissed notification permission remains retryable", async () => {
  assert.equal(pushPermissionError("default"), "push_permission_dismissed");
  assert.equal(pushPermissionError("denied"), "push_permission_denied");
  assert.equal(pushPermissionError("granted"), null);
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
  const subscriptionData = {
    endpoint: "https://fcm.googleapis.com/subscription/old-key",
    options: {
      applicationServerKey: Uint8Array.from({ length: 65 }, () => 1).buffer,
    },
    async unsubscribe() {
      unsubscribed = true;
      return true;
    },
  };
  const subscription = subscriptionData as unknown as PushSubscription;
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
  const currentSubscriptionData = {
    endpoint: "https://fcm.googleapis.com/subscription/current",
    toJSON() {
      return {
        endpoint: this.endpoint,
        expirationTime: null,
        keys: { p256dh: "P".repeat(65), auth: "A".repeat(22) },
      };
    },
  };
  const subscription = currentSubscriptionData as unknown as PushSubscription;

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

  assert.equal(roomId, "inspection-room-1");
});

test("recording and revising a result updates inspection progress immediately", () => {
  const inspection: InspectionDto = {
    id: "inspection-1",
    name: "August audit",
    technicianId: "employee-1",
    status: "draft",
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
  };
  const firstResult: ItemResultDto = {
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
  };
  const afterFirst = applyInspectionResult([inspection], firstResult);
  assert.equal(afterFirst[0]?.rooms[0]?.inspectedAt, firstResult.createdAt);
  assert.equal(afterFirst[0]?.results.length, 1);

  const revised = { ...firstResult, result: "broken", revisionNumber: 2 } as const;
  const afterRevision = applyInspectionResult(afterFirst, revised);
  assert.equal(afterRevision[0]?.results.length, 1);
  assert.equal(afterRevision[0]?.results[0]?.result, "broken");
  assert.equal(afterRevision[0]?.results[0]?.revisionNumber, 2);
});

async function clickWorker(
  url: string,
  clients: Array<Record<string, unknown>>,
) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const opened: string[] = [];
  const worker = {
    location: { origin: "https://inventory.test" },
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      listeners.set(type, listener);
    },
    registration: { async showNotification() {} },
    clients: {
      async matchAll() { return clients; },
      async openWindow(target: string) { opened.push(target); },
      async claim() {},
    },
  };
  vm.runInNewContext(await source("public/sw.js"), { self: worker, URL, Promise });
  let wait: Promise<unknown> | null = null;
  listeners.get("notificationclick")!({
    notification: { close() {}, data: { url } },
    waitUntil(promise: Promise<unknown>) { wait = promise; },
  });
  await wait;
  return { clients, opened };
}

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
