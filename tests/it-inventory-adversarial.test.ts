import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type {
  InsertLocalBarcodeGroup,
  LocalBarcodeGroupRecord,
  LocalBarcodeRepositories,
  LocalBarcodeRepository,
} from "../lib/application/ports/local-barcode-repositories";
import type {
  QrResolutionRecord,
  QrResolutionRepositories,
  QrResolutionRepository,
} from "../lib/application/ports/qr-resolution-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { LocalBarcodeService } from "../lib/application/services/local-barcode-service";
import { QrResolutionService } from "../lib/application/services/qr-resolution-service";
import type {
  CreateItInventoryItemInput,
  InventoryItemDto,
} from "../lib/contracts/inventory-items";
import { ApplicationError } from "../lib/domain/application-error";
import { toInventoryQrPrintItem } from "../lib/inventory-qr-print";

const ITEM_ID = "10000000-0000-4000-8000-000000000001";
const ADMIN_ID = "10000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "10000000-0000-4000-8000-000000000003";
const ROOM_ID = "10000000-0000-4000-8000-000000000004";
const BUILDING_ID = "10000000-0000-4000-8000-000000000005";

const IT_ITEM: InventoryItemRecord = {
  id: ITEM_ID,
  name: "IT camera",
  description: null,
  itemType: "camera",
  itemSection: "it",
  itType: "camera",
  networkAddresses: [],
  brand: null,
  model: null,
  quantity: 2,
  unitPrice: 100,
  roomId: ROOM_ID,
  roomDesignation: "101",
  floorNumber: 1,
  buildingId: BUILDING_ID,
  buildingName: "Main",
  inventoryNumberKind: "official",
  inventoryNumber: "IT-0001",
  status: "active",
  condition: "good",
  connectionStatus: "connected",
  qrCode: "YUQ1:it-camera",
  responsibleId: null,
  responsibleName: null,
  photoUrl: "/api/inventory/items/10000000-0000-4000-8000-000000000001/photo",
  photoIds: ["10000000-0000-4000-8000-000000000006"],
  version: 1,
  createdAt: new Date("2026-09-15T00:00:00.000Z"),
  updatedAt: new Date("2026-09-15T00:00:00.000Z"),
  archivedAt: null,
};

test("IT creation service rejects a hidden barcode even when called outside the HTTP parser", async () => {
  const jpeg = await jpegDataUrl();
  let insertedInventoryNumber: string | null = null;
  const service = createItemService({
    roomExists: async () => true,
    insertItem: async (input) => {
      insertedInventoryNumber = input.inventoryNumber;
      return {
        ...IT_ITEM,
        inventoryNumber: input.inventoryNumber,
        inventoryNumberKind: input.inventoryNumberKind,
        qrCode: null,
        photoUrl: null,
        photoIds: [],
      };
    },
    insertItemQr: async () => undefined,
    appendAudit: async () => undefined,
    replaceItNetworkAddresses: async () => [],
    updateItemPhoto: async () => ({ ...IT_ITEM, version: 2 }),
  });
  const maliciousInput = {
    name: "IT camera",
    roomId: ROOM_ID,
    itType: "camera",
    quantity: 1,
    photos: [{ imageDataUrl: jpeg, width: 2, height: 2 }],
    barcode: "*IT-ATTACK-01*",
  } as unknown as CreateItInventoryItemInput;

  await assert.rejects(
    service.createItItem(maliciousInput, { userId: ADMIN_ID, role: "admin" }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "validation" &&
      error.publicCode === "it_barcode_not_allowed",
    "the application boundary must enforce the IT barcode ban, not only the HTTP parser",
  );
  assert.equal(insertedInventoryNumber, null, "a barcode must never reach IT persistence");
});

test("an administrator cannot manufacture a local barcode for an IT record", async () => {
  let storedGroup: LocalBarcodeGroupRecord | null = null;
  const repository = {
    findActorForUpdate: async () => ({
      id: ADMIN_ID,
      role: "admin" as const,
      active: true,
      deletedAt: null,
      version: 1,
    }),
    findRecipientForUpdate: async () => ({
      id: EMPLOYEE_ID,
      fullName: "Employee",
      role: "employee" as const,
      active: true,
      deletedAt: null,
      defaultRoomId: ROOM_ID,
      roomActive: true,
    }),
    findItemForUpdate: async () => ({
      id: ITEM_ID,
      name: IT_ITEM.name,
      inventoryNumber: IT_ITEM.inventoryNumber,
      quantity: IT_ITEM.quantity,
      version: IT_ITEM.version,
      status: "active" as const,
      responsibleUserId: null,
      responsibleName: null,
      roomId: ROOM_ID,
      roomDesignation: "101",
      buildingId: BUILDING_ID,
      buildingName: "Main",
      itemSection: "it" as const,
    }),
    allocatedQuantity: async () => 0,
    advanceItemVersion: async () => true,
    nextSequence: async () => BigInt(1),
    isBarcodeRegistered: async () => false,
    insertGroup: async (input: InsertLocalBarcodeGroup) => {
      storedGroup = {
        id: input.id,
        itemId: input.itemId,
        itemName: IT_ITEM.name,
        originalBarcode: IT_ITEM.inventoryNumber,
        itemType: "camera",
        itemBrand: null,
        itemModel: null,
        itemDescription: null,
        unitPrice: 100,
        itemCondition: "good",
        itemConnectionStatus: "connected",
        itemPhotoId: IT_ITEM.photoIds?.[0] ?? null,
        parentGroupId: input.parentGroupId,
        sequenceNumber: input.sequenceNumber,
        barcodeValue: input.barcodeValue,
        barcodeKey: input.barcodeKey,
        quantity: input.quantity,
        responsibleUserId: input.responsibleUserId,
        responsibleName: "Employee",
        roomId: input.roomId,
        roomDesignation: "101",
        floorNumber: 1,
        buildingId: BUILDING_ID,
        buildingName: "Main",
        previousResponsibleUserId: null,
        previousResponsibleName: null,
        previousRoomId: ROOM_ID,
        createdBy: input.createdBy,
        createdAt: input.occurredAt,
        transferredAt: input.occurredAt,
        status: "active",
        cancelledBy: null,
        cancelledByName: null,
        cancelledAt: null,
        cancellationReason: null,
        version: 1,
        itemSection: "it",
      };
    },
    findGroup: async () => storedGroup,
    insertEvent: async () => undefined,
    appendAudit: async () => undefined,
  } as unknown as LocalBarcodeRepository;
  const repositories = {
    localBarcodes: repository,
    idempotency: {} as LocalBarcodeRepositories["idempotency"],
  } satisfies LocalBarcodeRepositories;
  const unitOfWork = directUnitOfWork(repositories);
  let id = 10;
  const service = new LocalBarcodeService(
    unitOfWork,
    { now: () => new Date("2026-09-15T00:00:00.000Z") },
    { create: () => `10000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
  );

  await assert.rejects(
    service.transfer(
      {
        itemId: ITEM_ID,
        sourceGroupId: null,
        recipientUserId: EMPLOYEE_ID,
        quantity: 1,
        sourceVersion: 1,
      },
      { userId: ADMIN_ID, role: "admin", sessionVersion: 1 },
    ),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "validation" &&
      error.publicCode === "it_barcode_not_allowed",
    "the local-barcode API must reject every IT item, including for administrators",
  );
  assert.equal(storedGroup, null, "no barcode group may be persisted for IT inventory");
});

test("the local-barcode distribution endpoint cannot expose an IT record as an original barcode", async () => {
  const repository = {
    findItem: async () => ({
      id: ITEM_ID,
      name: IT_ITEM.name,
      inventoryNumber: IT_ITEM.inventoryNumber,
      quantity: IT_ITEM.quantity,
      version: IT_ITEM.version,
      status: "active" as const,
      responsibleUserId: null,
      responsibleName: null,
      roomId: ROOM_ID,
      roomDesignation: "101",
      buildingId: BUILDING_ID,
      buildingName: "Main",
      itemSection: "it" as const,
    }),
    listGroups: async () => [],
  } as unknown as LocalBarcodeRepository;
  const service = new LocalBarcodeService(
    directUnitOfWork({
      localBarcodes: repository,
      idempotency: {} as LocalBarcodeRepositories["idempotency"],
    } satisfies LocalBarcodeRepositories),
    { now: () => new Date("2026-09-15T00:00:00.000Z") },
    { create: () => "10000000-0000-4000-8000-000000000011" },
  );

  await assert.rejects(
    service.getDistribution(ITEM_ID, { userId: ADMIN_ID, role: "admin" }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.kind === "not_found" &&
      error.publicCode === "item_not_found",
    "IT records must not be projected into the local-barcode API at all",
  );
});

test("IT inventory is absent from barcode resolution even for an administrator", async () => {
  const record: QrResolutionRecord = {
    canonicalKey: IT_ITEM.inventoryNumber,
    format: "legacy_raw",
    qrStatus: "active",
    targetKind: "item",
    targetId: ITEM_ID,
    targetStatus: "active",
    title: IT_ITEM.name,
    buildingName: IT_ITEM.buildingName,
    roomDesignation: IT_ITEM.roomDesignation,
    inventoryNumber: IT_ITEM.inventoryNumber,
    responsibleName: null,
    responsibleUserId: null,
    itemType: "camera",
    itemSection: "it",
    itemBrand: null,
    itemModel: null,
    itemDescription: null,
    itemQuantity: 2,
    itemUnitPrice: 100,
    itemCondition: "good",
    itemConnectionStatus: "connected",
    itemHasPhoto: true,
    itemCreatedAt: IT_ITEM.createdAt,
  };
  const qr = {
    findByCanonicalKey: async () => null,
    findItemByBarcode: async () => record,
  } satisfies QrResolutionRepository;
  const service = new QrResolutionService(
    directUnitOfWork({ qr } satisfies QrResolutionRepositories),
  );

  const result = await service.resolve(
    IT_ITEM.inventoryNumber,
    { userId: ADMIN_ID, role: "admin" },
    "barcode",
    "item",
  );

  assert.equal(result.status, "unknown", "removing IT barcodes requires removing their scan namespace too");
  assert.equal(result.target, null);
});

test("the print model never derives a Code 39 barcode for an IT record", () => {
  const printable = toInventoryQrPrintItem(toItemDtoFixture(IT_ITEM), "barcode");
  assert.equal(
    printable.printableValue,
    null,
    "the shared /items/:id/qr page must not be able to manufacture an IT barcode payload",
  );
});

test("the ordinary item details page fails closed when an administrator supplies an IT item id", async () => {
  const detailsPage = await readFile("app/(protected)/items/[id]/page.tsx", "utf8");
  assert.match(
    detailsPage,
    /item\.itemSection\s*!==\s*["']general["'][\s\S]{0,80}notFound\(\)/,
    "the ordinary details route must not render an IT record from a guessed id",
  );
});

test("the ordinary item API does not return IT records from guessed ids", async () => {
  const itemApi = await readFile("app/api/inventory/items/[id]/route.ts", "utf8");
  assert.match(
    itemApi,
    /item\.itemSection\s*!==\s*["']general["'][\s\S]{0,100}(?:itemNotFound|ApplicationError)/,
    "the general-item API must enforce section isolation after resolving an id",
  );
});

function createItemService(methods: Partial<InventoryItemRepository>) {
  const repositories = { items: methods as InventoryItemRepository } satisfies InventoryItemRepositories;
  return new InventoryItemService(
    directUnitOfWork(repositories),
    { now: () => new Date("2026-09-15T00:00:00.000Z") },
    { create: () => ITEM_ID },
    { create: () => new Uint8Array(16) },
    { next: () => "TMP-2026-000001" },
  );
}

function directUnitOfWork<TRepositories>(repositories: TRepositories) {
  return {
    read: async <Result>(work: (value: TRepositories) => Promise<Result>) => work(repositories),
    transaction: async <Result>(work: (value: TRepositories) => Promise<Result>) => work(repositories),
  } as UnitOfWork<TRepositories>;
}

function toItemDtoFixture(record: InventoryItemRecord): InventoryItemDto {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    itemType: record.itemType,
    itemSection: record.itemSection ?? "general",
    itType: record.itType ?? null,
    networkAddresses: record.networkAddresses ?? [],
    category: undefined,
    brand: record.brand,
    model: record.model,
    quantity: record.quantity,
    unitPrice: record.unitPrice,
    room: {
      id: record.roomId,
      designation: record.roomDesignation,
      floorNumber: record.floorNumber,
      buildingId: record.buildingId,
      buildingName: record.buildingName,
    },
    inventoryNumberKind: record.inventoryNumberKind,
    inventoryNumber: record.inventoryNumber,
    status: record.status,
    condition: record.condition,
    connectionStatus: record.connectionStatus,
    qrCode: record.qrCode,
    responsible: null,
    photoUrl: record.photoUrl,
    photoUrls: record.photoIds?.map((photoId) => `${record.photoUrl}?photoId=${photoId}`) ?? [],
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}

async function jpegDataUrl() {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
