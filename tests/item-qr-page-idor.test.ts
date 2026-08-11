import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ApplicationError } from "../lib/domain/application-error";
import type { InventoryItemDto } from "../lib/contracts/inventory-items";
import { toInventoryQrPrintItem } from "../lib/inventory-qr-print";
import { readHiddenPageResource } from "../lib/server/security/hidden-page-resource";

const pageSource = readFileSync(
  new URL("../app/(protected)/items/[id]/qr/page.tsx", import.meta.url),
  "utf8",
);
const printViewSource = readFileSync(
  new URL("../components/InventoryQrPrintView.tsx", import.meta.url),
  "utf8",
);

test("item QR page hides foreign and missing IDs behind the same 404", async () => {
  const missing = await captureFailure(() =>
    readHiddenPageResource(async () => {
      throw new ApplicationError("not_found", "item_not_found");
    }, hideAsNotFound),
  );
  const foreign = await captureFailure(() =>
    readHiddenPageResource(async () => {
      throw new ApplicationError("forbidden", "forbidden");
    }, hideAsNotFound),
  );

  assert.deepEqual(errorShape(foreign), errorShape(missing));
  assert.deepEqual(errorShape(missing), {
    message: "NEXT_HTTP_ERROR_FALLBACK;404",
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
});

test("item QR page rejects malformed or unauthorized IDs without hiding readable legacy-building items", () => {
  assert.match(pageSource, /if \(!isUuid\(id\)\) notFound\(\);/);
  assert.match(
    pageSource,
    /await readHiddenPageResource\(\s*\(\) => [\s\S]*?items\.findItem\(id, actor\),\s*notFound,\s*\)/,
  );
  assert.doesNotMatch(pageSource, /isInventoryBuildingName/);
});

test("item QR page authorizes privileged QR mode before looking up the item", () => {
  assert.match(
    pageSource,
    /const canManageQr = hasPermission\(user\.role, "inventory\.qr\.manage"\);/,
  );
  assert.match(pageSource, /if \(kind === "qr" && !canManageQr\) notFound\(\);/);
  const qrGate = pageSource.indexOf('kind === "qr" &&');
  const itemRead = pageSource.indexOf("await readHiddenPageResource");
  assert.ok(qrGate >= 0 && itemRead >= 0 && qrGate < itemRead);
});

test("item QR page serializes a least-privilege print model instead of the item DTO", () => {
  assert.match(pageSource, /toInventoryQrPrintItem\(item, kind\)/);
  assert.doesNotMatch(pageSource, /<InventoryQrPrintView item=\{item\}/);
  assert.doesNotMatch(printViewSource, /InventoryItemDto/);
  assert.match(printViewSource, /InventoryQrPrintItem/);
});

test("barcode projection does not serialize QR or hidden item metadata", () => {
  const item: InventoryItemDto = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Laptop",
    description: "internal description",
    itemType: "Equipment",
    brand: "Secret brand",
    model: "Secret model",
    quantity: 5,
    unitPrice: 900_000,
    inventoryNumberKind: "official",
    inventoryNumber: "INV-42",
    room: {
      id: "22222222-2222-4222-8222-222222222222",
      designation: "101",
      floorNumber: 1,
      buildingId: "33333333-3333-4333-8333-333333333333",
      buildingName: "Main",
    },
    status: "active",
    qrCode: "YUQ1:secret-capability",
    responsible: { id: "44444444-4444-4444-8444-444444444444", name: "Owner" },
    photoUrl: "/private-photo",
    servicePhotoUrl: "/private-service-photo",
    version: 7,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    archivedAt: null,
  };

  assert.deepEqual(toInventoryQrPrintItem(item, "barcode"), {
    id: item.id,
    name: "Laptop",
    itemType: "Equipment",
    inventoryNumber: "INV-42",
    room: { designation: "101", buildingName: "Main" },
    printableValue: "INV-42",
  });
  assert.equal(
    toInventoryQrPrintItem(item, "qr").printableValue,
    "YUQ1:secret-capability",
  );
});

async function captureFailure(read: () => Promise<unknown>): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error;
  }
  assert.fail("expected the page resource read to fail");
}

function hideAsNotFound(): never {
  throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
}

function errorShape(error: unknown) {
  assert.ok(error instanceof Error);
  return {
    message: error.message,
    digest:
      "digest" in error && typeof error.digest === "string"
        ? error.digest
        : undefined,
  };
}
