import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import type {
  InventoryResponsibilityRepositories,
  InventoryResponsibilityRepository,
} from "../lib/application/ports/inventory-responsibility-repositories";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { ApplicationError } from "../lib/domain/application-error";

const GENERAL_ID = "11111111-1111-4111-8111-111111111111";
const IT_ID = "22222222-2222-4222-8222-222222222222";
const GENERAL_COMPONENT_ID = "33333333-3333-4333-8333-333333333333";
const IT_COMPONENT_ID = "44444444-4444-4444-8444-444444444444";
const ROOM_ID = "55555555-5555-4555-8555-555555555555";

const GENERAL_ITEM = item(GENERAL_ID, "general");
const IT_ITEM = item(IT_ID, "it", "employee-1");
const GENERAL_COMPONENT = item(GENERAL_COMPONENT_ID, "general");
const IT_COMPONENT = item(IT_COMPONENT_ID, "it");

test("malformed IT network-address rows fail with a validation error", async () => {
  const jpeg = await jpegDataUrl();
  let repositoryRead = false;
  const service = createService({
    roomExists: async () => {
      repositoryRead = true;
      return true;
    },
  });

  for (const malformed of [[null], [42], ["10.0.0.1"], [[]]]) {
    await assert.rejects(
      service.createItItem(
        {
          name: "Camera",
          roomId: ROOM_ID,
          itType: "camera",
          quantity: 1,
          photos: [{ imageDataUrl: jpeg, width: 2, height: 2 }],
          networkAddresses: malformed as never,
        },
        { userId: "admin-1", role: "admin" },
      ),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.kind === "validation" &&
        error.publicCode === "invalid_it_network_addresses",
      `expected a validation error for ${JSON.stringify(malformed)}`,
    );
  }

  assert.equal(repositoryRead, false, "invalid rows must be rejected before persistence");
});

test("a composition cannot link general and IT inventory", async () => {
  let insertCount = 0;
  let auditCount = 0;
  const records = [GENERAL_ITEM, IT_ITEM];
  const service = createService({
    findItemById: async (id) => records.find((record) => record.id === id) ?? null,
    insertComponent: async () => {
      insertCount += 1;
    },
    appendAudit: async () => {
      auditCount += 1;
    },
    listComponents: async () => [],
  });

  await assert.rejects(
    service.addComponent(GENERAL_ID, IT_ID, { userId: "admin-1", role: "admin" }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "validation" &&
      error.publicCode === "item_component_section_mismatch",
  );
  assert.equal(insertCount, 0);
  assert.equal(auditCount, 0);
});

test("composition reads and candidate search hide records from another inventory section", async () => {
  const service = createService({
    findItemById: async (id) =>
      [GENERAL_ITEM, IT_ITEM].find((record) => record.id === id) ?? null,
    listComponents: async (id) =>
      id === GENERAL_ID
        ? [GENERAL_COMPONENT, IT_COMPONENT]
        : [IT_COMPONENT, GENERAL_COMPONENT],
    searchComponentCandidates: async (id) =>
      id === GENERAL_ID
        ? [GENERAL_COMPONENT, IT_COMPONENT]
        : [IT_COMPONENT, GENERAL_COMPONENT],
  });

  const actor = { userId: "admin-1", role: "admin" } as const;
  assert.deepEqual(
    (await service.listComponents(GENERAL_ID, actor)).map((record) => record.id),
    [GENERAL_COMPONENT_ID],
  );
  assert.deepEqual(
    (await service.listComponents(IT_ID, actor)).map((record) => record.id),
    [IT_COMPONENT_ID],
  );
  assert.deepEqual(
    (await service.searchComponentCandidates(GENERAL_ID, "", actor)).map(
      (record) => record.id,
    ),
    [GENERAL_COMPONENT_ID],
  );
  assert.deepEqual(
    (await service.searchComponentCandidates(IT_ID, "", actor)).map(
      (record) => record.id,
    ),
    [IT_COMPONENT_ID],
  );
});

test("non-administrators cannot read IT photos or audit records", async () => {
  for (const actor of [
    { userId: "warehouse-1", role: "warehouse" as const },
    { userId: "employee-1", role: "employee" as const },
  ]) {
    let photoRead = false;
    let auditRead = false;
    const service = createService({
      findItemById: async () => IT_ITEM,
      findItemPhoto: async () => {
        photoRead = true;
        return { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };
      },
      listAudit: async () => {
        auditRead = true;
        return [];
      },
    });

    await assert.rejects(
      service.getItemPhoto(IT_ID, actor),
      isForbidden,
    );
    await assert.rejects(
      service.listAudit(IT_ID, actor),
      isForbidden,
    );
    assert.equal(photoRead, false);
    assert.equal(auditRead, false);
  }
});

test("warehouse cannot read an IT item's responsibility timeline", async () => {
  let timelineRead = false;
  const responsibility = {
    findItemState: async () => ({
      itemId: IT_ID,
      responsibilityPeriodId: null,
      responsibleUserId: null,
      responsibleName: null,
      itemStatus: "active" as const,
      itemSection: "it" as const,
    }),
    listTimeline: async () => {
      timelineRead = true;
      return [];
    },
  } as unknown as InventoryResponsibilityRepository;
  const repositories = { responsibility } satisfies InventoryResponsibilityRepositories;
  const unitOfWork: UnitOfWork<InventoryResponsibilityRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new InventoryResponsibilityService(
    unitOfWork,
    { now: () => new Date("2026-09-15T00:00:00.000Z") },
    { create: () => "77777777-7777-4777-8777-000000000001" },
  );

  await assert.rejects(
    service.listTimeline(IT_ID, { userId: "warehouse-1", role: "warehouse" }),
    isForbidden,
  );
  assert.equal(timelineRead, false);
});

test("an assigned employee cannot send an IT item to service", async () => {
  const jpeg = await jpegDataUrl();
  const mutations: string[] = [];
  const service = createService({
    findItemById: async () => IT_ITEM,
    insertServiceItemPhoto: async () => {
      mutations.push("photo");
    },
    updateItemStatus: async () => {
      mutations.push("status");
      return { ...IT_ITEM, status: "maintenance", version: 2 };
    },
    appendAudit: async () => {
      mutations.push("audit");
    },
  });

  await assert.rejects(
    service.sendToService(
      IT_ID,
      1,
      {
        serviceName: "Vendor",
        reason: "Diagnostics",
        photo: { imageDataUrl: jpeg, width: 2, height: 2 },
      },
      { userId: "employee-1", role: "employee" },
    ),
    isForbidden,
  );
  assert.deepEqual(mutations, []);
});

test("bulk location and deletion commands never cross their declared section", async () => {
  const records = new Map([
    [GENERAL_ID, GENERAL_ITEM],
    [IT_ID, IT_ITEM],
  ]);
  const locationUpdates: string[] = [];
  const deleteCalls: string[][] = [];
  const service = createService({
    roomExists: async () => true,
    findItemById: async (id) => records.get(id) ?? null,
    updateItemLocation: async (input) => {
      locationUpdates.push(input.id);
      const current = records.get(input.id)!;
      return { ...current, roomId: input.roomId, version: current.version + 1 };
    },
    appendAudit: async () => undefined,
    deleteItems: async (ids) => {
      deleteCalls.push([...ids]);
      return [...ids];
    },
  });
  const actor = { userId: "admin-1", role: "admin" } as const;

  const generalResult = await service.bulkChangeLocation(
    {
      itemSection: "general",
      roomId: ROOM_ID,
      items: [
        { itemId: GENERAL_ID, itemVersion: 1 },
        { itemId: IT_ID, itemVersion: 1 },
      ],
    },
    actor,
  );
  assert.deepEqual(locationUpdates, [GENERAL_ID]);
  assert.deepEqual(generalResult.items[1], {
    itemId: IT_ID,
    outcome: "problem",
    problem: "item_not_found",
  });

  locationUpdates.length = 0;
  const itResult = await service.bulkChangeLocation(
    {
      itemSection: "it",
      roomId: ROOM_ID,
      items: [
        { itemId: GENERAL_ID, itemVersion: 1 },
        { itemId: IT_ID, itemVersion: 1 },
      ],
    },
    actor,
  );
  assert.deepEqual(locationUpdates, [IT_ID]);
  assert.deepEqual(itResult.items[0], {
    itemId: GENERAL_ID,
    outcome: "problem",
    problem: "item_not_found",
  });

  assert.deepEqual(
    await service.deleteItems([GENERAL_ID, IT_ID], actor, "general"),
    [GENERAL_ID],
  );
  assert.deepEqual(
    await service.deleteItems([GENERAL_ID, IT_ID], actor, "it"),
    [IT_ID],
  );
  assert.deepEqual(deleteCalls, [[GENERAL_ID], [IT_ID]]);
});

test("the general bulk-category command cannot mutate IT inventory by ID", async () => {
  let updateCount = 0;
  let auditCount = 0;
  const service = createService({
    findItemById: async () => IT_ITEM,
    updateItemCategory: async () => {
      updateCount += 1;
      return { ...IT_ITEM, itemType: "furniture", version: 2 };
    },
    appendAudit: async () => {
      auditCount += 1;
    },
  });

  assert.deepEqual(
    await service.bulkChangeCategory(
      [IT_ID],
      "furniture",
      { userId: "admin-1", role: "admin" },
    ),
    [],
  );
  assert.equal(updateCount, 0);
  assert.equal(auditCount, 0);
});

function item(
  id: string,
  itemSection: "general" | "it",
  responsibleId: string | null = null,
): InventoryItemRecord {
  const isIt = itemSection === "it";
  return {
    id,
    name: isIt ? "Camera" : "Desk",
    description: null,
    itemType: isIt ? "camera" : "furniture",
    itemSection,
    itType: isIt ? "camera" : null,
    networkAddresses: [],
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 100,
    roomId: ROOM_ID,
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: "66666666-6666-4666-8666-666666666666",
    buildingName: "Main",
    inventoryNumberKind: "official",
    inventoryNumber: `INV-${id.slice(0, 4)}`,
    status: "active",
    condition: "good",
    connectionStatus: "not_applicable",
    qrCode: null,
    responsibleId,
    responsibleName: responsibleId ? "Employee" : null,
    photoUrl: `/api/inventory/items/${id}/photo`,
    photoIds: ["photo-1"],
    version: 1,
    createdAt: new Date("2026-09-15T00:00:00.000Z"),
    updatedAt: new Date("2026-09-15T00:00:00.000Z"),
    archivedAt: null,
  };
}

function createService(methods: Partial<InventoryItemRepository>) {
  const repositories = {
    items: methods as InventoryItemRepository,
  } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  let id = 0;
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-09-15T00:00:00.000Z") },
    { create: () => `77777777-7777-4777-8777-${String(++id).padStart(12, "0")}` },
    { create: () => new Uint8Array(16) },
    { next: () => "TMP-2026-000001" },
  );
}

function isForbidden(error: unknown) {
  return (
    error instanceof ApplicationError &&
    error.kind === "forbidden" &&
    error.publicCode === "forbidden"
  );
}

async function jpegDataUrl() {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
