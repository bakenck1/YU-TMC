import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { ApplicationError } from "../lib/domain/application-error";
import { applicationErrorResponse } from "../lib/server/http/error-response";
import {
  assertPhotoJsonRequest,
  itemPhotoResponse,
  MAX_PHOTO_JSON_BYTES,
  readPhotoJsonRequest,
} from "../lib/server/http/photo-request";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function item(responsibleId: string | null): InventoryItemRecord {
  return {
    id: ITEM_ID,
    name: "Monitor",
    description: null,
    itemType: "Equipment",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 1,
    roomId: "22222222-2222-4222-8222-222222222222",
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: "33333333-3333-4333-8333-333333333333",
    buildingName: "Main",
    inventoryNumberKind: "official",
    inventoryNumber: "INV-1",
    status: "active",
    qrCode: null,
    responsibleId,
    responsibleName: responsibleId ? "Employee" : null,
    photoUrl: `/api/inventory/items/${ITEM_ID}/photo`,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
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
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-08-03T00:00:00.000Z") },
    { create: () => "44444444-4444-4444-8444-444444444444" },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );
}

test("does not expose another employee's item photo through a known item UUID", async () => {
  let photoRead = false;
  const service = createService({
    findItemById: async () => item("employee-2"),
    findItemPhoto: async () => {
      photoRead = true;
      return { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };
    },
  });

  await assert.rejects(
    service.getItemPhoto(ITEM_ID, { userId: "employee-1", role: "employee" }),
    (error: unknown) =>
      error instanceof Error && error.message === "item_photo_not_found",
  );
  assert.equal(photoRead, false);
});

test("returns an item photo to its current responsible employee", async () => {
  const service = createService({
    findItemById: async () => item("employee-1"),
    findItemPhoto: async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    }),
  });

  const photo = await service.getItemPhoto(ITEM_ID, {
    userId: "employee-1",
    role: "employee",
  });
  assert.deepEqual(photo.bytes, new Uint8Array([0xff, 0xd8, 0xff]));
});

test("rejects bytes labelled as JPEG when the image cannot be decoded", async () => {
  let photoWrite = false;
  const service = createService({
    findItemById: async () => item(null),
    updateItemPhoto: async () => {
      photoWrite = true;
      return item(null);
    },
    appendAudit: async () => undefined,
  });

  await assert.rejects(
    service.updatePhoto(
      ITEM_ID,
      {
        version: 1,
        imageDataUrl: "data:image/jpeg;base64,QQ==",
        width: 1,
        height: 1,
      },
      { userId: "admin-1", role: "admin" },
    ),
    /invalid_camera_photo/,
  );
  assert.equal(photoWrite, false);
});

test("stores dimensions derived from the decoded JPEG instead of client claims", async () => {
  const jpeg = await sharp({
    create: {
      width: 2,
      height: 3,
      channels: 3,
      background: "white",
    },
  })
    .jpeg()
    .toBuffer();
  let storedWidth: number | undefined;
  let storedHeight: number | undefined;
  const service = createService({
    findItemById: async () => item(null),
    updateItemPhoto: async (input) => {
      storedWidth = input.width;
      storedHeight = input.height;
      return { ...item(null), version: 2 };
    },
    appendAudit: async () => undefined,
  });

  await service.updatePhoto(
    ITEM_ID,
    {
      version: 1,
      imageDataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      width: 100,
      height: 100,
    },
    { userId: "admin-1", role: "admin" },
  );

  assert.equal(storedWidth, 2);
  assert.equal(storedHeight, 3);
});

test("photo route guards JSON before parsing", () => {
  const source = readFileSync(
    "app/api/inventory/items/[id]/photo/route.ts",
    "utf8",
  );
  const guard = source.indexOf("assertPhotoJsonRequest(request)");
  const parse = source.indexOf("readPhotoJsonRequest(request)", guard);

  assert.ok(guard >= 0 && guard < parse, "request limits must run before JSON parsing");
  assert.doesNotMatch(source, /request\.json\(\)/);
  assert.match(source, /itemPhotoResponse\(photo\.bytes, photo\.mimeType\)/);
  assert.doesNotMatch(source, /photo\.bytes\.buffer/);
});

test("photo response contains only the selected byte range and cannot be cached", async () => {
  const backing = new Uint8Array([10, 20, 30, 40, 50]);
  const response = itemPhotoResponse(backing.subarray(1, 4), "image/jpeg");

  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([20, 30, 40]),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "image/jpeg");
});

test("photo JSON guard enforces media type and declared size", () => {
  const assertKind = (request: Request, kind: ApplicationError["kind"]) =>
    assert.throws(
      () => assertPhotoJsonRequest(request),
      (error: unknown) => error instanceof ApplicationError && error.kind === kind,
    );

  assertKind(
    new Request("https://inventory.example/photo", {
      method: "POST",
      headers: { "content-type": "text/plain", "content-length": "1" },
    }),
    "unsupported_media_type",
  );
  assertKind(
    new Request("https://inventory.example/photo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_PHOTO_JSON_BYTES + 1),
      },
    }),
    "payload_too_large",
  );
  assert.doesNotThrow(() =>
    assertPhotoJsonRequest(
      new Request("https://inventory.example/photo", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(MAX_PHOTO_JSON_BYTES),
        },
      }),
    ),
  );
  assert.equal(
    applicationErrorResponse(
      new ApplicationError("unsupported_media_type", "unsupported_media_type"),
    ).status,
    415,
  );
  assert.equal(
    applicationErrorResponse(
      new ApplicationError("payload_too_large", "payload_too_large"),
    ).status,
    413,
  );
});

test("photo JSON reader rejects an oversized chunked body before parsing", async () => {
  const oversized = "x".repeat(MAX_PHOTO_JSON_BYTES + 1);
  const request = new Request("https://inventory.example/photo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: oversized,
  });
  assertPhotoJsonRequest(request);

  await assert.rejects(
    readPhotoJsonRequest(request),
    (error: unknown) =>
      error instanceof ApplicationError && error.kind === "payload_too_large",
  );
});
