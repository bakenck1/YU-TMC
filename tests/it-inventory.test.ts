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
import { createPostgresInventoryItemRepositories } from "../lib/server/persistence/postgres/postgres-inventory-item-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";
import { canAccessPath } from "../lib/security/authorization";
import { hasPermission } from "../lib/security/permissions";
import { canonicalInventoryDetailsReturnHref } from "../lib/inventory-list-state";

const GENERAL_ITEM: InventoryItemRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Chair",
  description: null,
  itemType: "furniture",
  itemSection: "general",
  itType: null,
  networkAddresses: [],
  brand: null,
  model: null,
  quantity: 1,
  unitPrice: 0,
  roomId: "22222222-2222-4222-8222-222222222222",
  roomDesignation: "101",
  floorNumber: 1,
  buildingId: "33333333-3333-4333-8333-333333333333",
  buildingName: "Main",
  inventoryNumberKind: "official",
  inventoryNumber: "INV-1",
  status: "active",
  condition: "good",
  connectionStatus: "not_applicable",
  qrCode: null,
  responsibleId: null,
  responsibleName: null,
  photoUrl: null,
  version: 1,
  createdAt: new Date("2026-09-15T00:00:00.000Z"),
  updatedAt: new Date("2026-09-15T00:00:00.000Z"),
  archivedAt: null,
};

const IT_ITEM: InventoryItemRecord = {
  ...GENERAL_ITEM,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Lobby access point",
  itemType: "wifi_access_point",
  itemSection: "it",
  itType: "wifi_access_point",
  networkAddresses: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      deviceLabel: "Точка 1",
      ipAddress: "192.168.1.10",
      macAddress: "AA:BB:CC:DD:EE:01",
    },
  ],
};

function createService(methods: Partial<InventoryItemRepository>) {
  const repositories = {
    items: methods as InventoryItemRepository,
  } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-09-15T00:00:00.000Z") },
    { create: () => "66666666-6666-4666-8666-666666666666" },
    { create: () => new Uint8Array(16) },
    { next: () => "TMP-2026-000001" },
  );
}

test("IT inventory route and permissions are administrator-only", () => {
  assert.equal(hasPermission("admin", "inventory.it.read"), true);
  assert.equal(hasPermission("admin", "inventory.it.manage"), true);
  assert.equal(canAccessPath("admin", "/it-items"), true);
  for (const role of ["warehouse", "employee"] as const) {
    assert.equal(hasPermission(role, "inventory.it.read"), false);
    assert.equal(hasPermission(role, "inventory.it.manage"), false);
    assert.equal(canAccessPath(role, "/it-items"), false);
    assert.equal(canAccessPath(role, `/it-items/${IT_ITEM.id}`), false);
  }
});

test("IT inventory detail links preserve only canonical IT list state", () => {
  assert.equal(
    canonicalInventoryDetailsReturnHref("/it-items?q=camera&page=3&pageSize=20"),
    "/it-items?q=camera&page=3&pageSize=20",
  );
  assert.equal(canonicalInventoryDetailsReturnHref("/it-items-archive?q=camera"), null);
});

test("ordinary and IT repository collections are separated by the system section", async () => {
  const queries: string[] = [];
  const source = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PostgresRepositorySource;
  const repository = createPostgresInventoryItemRepositories(source).items;

  await repository.listItems();
  await repository.listItItems();

  assert.match(queries[0]!, /i\.item_section\s*=\s*'general'/i);
  assert.match(queries[1]!, /i\.item_section\s*=\s*'it'/i);
});

test("IT list is available only to administrators", async () => {
  let calls = 0;
  const service = createService({
    listItItems: async () => {
      calls += 1;
      return [IT_ITEM];
    },
  });

  const result = await service.listItItems({ userId: "admin-1", role: "admin" });
  assert.equal(result[0]?.itemSection, "it");
  assert.equal(result[0]?.itType, "wifi_access_point");
  assert.equal(result[0]?.networkAddresses[0]?.ipAddress, "192.168.1.10");

  await assert.rejects(
    service.listItItems({ userId: "warehouse-1", role: "warehouse" }),
    /forbidden/,
  );
  assert.equal(calls, 1);
});

test("direct reads of an IT item fail closed for non-administrators", async () => {
  const service = createService({ findItemById: async () => IT_ITEM });

  await assert.rejects(
    service.findItem(IT_ITEM.id, { userId: "warehouse-1", role: "warehouse" }),
    (error: unknown) =>
      error instanceof Error &&
      "kind" in error &&
      error.kind === "forbidden",
  );
  await assert.rejects(
    service.findItem(IT_ITEM.id, { userId: "employee-1", role: "employee" }),
    (error: unknown) =>
      error instanceof Error &&
      "kind" in error &&
      error.kind === "forbidden",
  );
  assert.equal(
    (await service.findItem(IT_ITEM.id, { userId: "admin-1", role: "admin" })).itemSection,
    "it",
  );
});

test("ordinary list remains general inventory only at the service boundary", async () => {
  const service = createService({ listItems: async () => [GENERAL_ITEM, IT_ITEM] });
  const items = await service.listItems({ userId: "admin-1", role: "admin" });
  assert.deepEqual(items.map((item) => item.id), [GENERAL_ITEM.id]);
});

test("creating IT equipment requires an allowed type and at least one photo", async () => {
  const service = createService({});
  const base = {
    name: "Camera 1",
    roomId: GENERAL_ITEM.roomId,
    quantity: 1,
    unitPrice: 100,
    networkAddresses: [],
  };

  await assert.rejects(
    service.createItItem(
      { ...base, itType: "router" as never, photos: [] },
      { userId: "admin-1", role: "admin" },
    ),
    /invalid_it_equipment_type/,
  );
  await assert.rejects(
    service.createItItem(
      { ...base, itType: "camera", photos: [] },
      { userId: "admin-1", role: "admin" },
    ),
    /item_photo_required/,
  );
  await assert.rejects(
    service.createItItem(
      { ...base, quantity: undefined as never, itType: "camera", photos: [{} as never] },
      { userId: "admin-1", role: "admin" },
    ),
    /invalid_item_quantity/,
  );
  await assert.rejects(
    service.createItItem(
      { ...base, itType: "camera", photos: [] },
      { userId: "warehouse-1", role: "warehouse" },
    ),
    /forbidden/,
  );
});

test("empty address rows are dropped without normalizing entered address text", async () => {
  let replaced: Parameters<NonNullable<InventoryItemRepository["replaceItNetworkAddresses"]>>[1] | undefined;
  const repository = {
    roomExists: async () => true,
    insertItem: async () => ({ ...IT_ITEM, photoUrl: null, photoIds: [] }),
    insertItemQr: async () => undefined,
    appendAudit: async () => undefined,
    updateItemPhoto: async () => ({ ...IT_ITEM, photoUrl: "/photo", photoIds: ["photo-1"], version: 2 }),
    replaceItNetworkAddresses: async (_id, addresses) => {
      replaced = addresses;
      return addresses.map((address, index) => ({
        id: `address-${index}`,
        ...address,
      }));
    },
  } as unknown as InventoryItemRepository;
  const service = createService(repository);
  const jpegBytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  }).jpeg().toBuffer();
  const jpeg = `data:image/jpeg;base64,${jpegBytes.toString("base64")}`;

  const created = await service.createItItem(
    {
      name: "Camera 1",
      roomId: GENERAL_ITEM.roomId,
      itType: "camera",
      quantity: 1,
      photos: [{ imageDataUrl: jpeg, width: 1, height: 1 }],
      networkAddresses: [
        { deviceLabel: "", ipAddress: "", macAddress: "" },
        { deviceLabel: " Камера A ", ipAddress: " 10.0.0.7 ", macAddress: " aa-bb " },
      ],
    },
    { userId: "admin-1", role: "admin" },
  );

  assert.deepEqual(replaced, [
    { deviceLabel: " Камера A ", ipAddress: " 10.0.0.7 ", macAddress: " aa-bb " },
  ]);
  assert.deepEqual(created.networkAddresses, [
    {
      id: "address-0",
      deviceLabel: " Камера A ",
      ipAddress: " 10.0.0.7 ",
      macAddress: " aa-bb ",
    },
  ]);
});

test("the last required IT equipment photo cannot be removed", async () => {
  let removeCalls = 0;
  const service = createService({
    findItemById: async () => ({
      ...IT_ITEM,
      photoUrl: "/api/inventory/items/photo-1/photo",
      photoIds: ["photo-1"],
    }),
    removeItemPhoto: async () => {
      removeCalls += 1;
      return null;
    },
  });

  await assert.rejects(
    service.removePhoto(
      IT_ITEM.id,
      IT_ITEM.version,
      { userId: "admin-1", role: "admin" },
      "photo-1",
    ),
    /item_photo_required/,
  );
  assert.equal(removeCalls, 0);
});

test("an IT photo deletion cannot omit photoId and remove the entire gallery", async () => {
  let removeCalls = 0;
  const service = createService({
    findItemById: async () => ({
      ...IT_ITEM,
      photoUrl: "/api/inventory/items/photo-1/photo",
      photoIds: ["photo-1", "photo-2"],
    }),
    removeItemPhoto: async () => {
      removeCalls += 1;
      return null;
    },
  });

  await assert.rejects(
    service.removePhoto(
      IT_ITEM.id,
      IT_ITEM.version,
      { userId: "admin-1", role: "admin" },
    ),
    /item_photo_required/,
  );
  assert.equal(removeCalls, 0);
});
