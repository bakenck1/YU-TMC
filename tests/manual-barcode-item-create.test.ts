import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
  InsertInventoryItemRecord,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { parseCode39ScanInput } from "../lib/domain/code39";

const ROOT = new URL("../", import.meta.url);

test("manual barcode input is sent to the item creation API", async () => {
  const form = await readFile(
    new URL("components/InventoryItemCreateForm.tsx", ROOT),
    "utf8",
  );
  const route = await readFile(
    new URL("app/api/inventory/items/route.ts", ROOT), "utf8");

  assert.match(form, /const \[barcode, setBarcode\] = useState\(""\)/);
  assert.match(form, /barcode: restricted \? null : \(barcode \|\| null\)/);
  assert.match(route, /actor\.role === "warehouse"/);
  assert.match(form, /t\("createItem\.barcodeHint"\)/);
  assert.match(route, /typeof body\.barcode !== "string"/);
  assert.match(form, /!barcode\.trim\(\)/);
  assert.match(form, /setBarcode\(value\)/);
});

test("a manually entered barcode is normalized before database persistence", async () => {
  let inserted: InventoryItemRecord | undefined;
  const repositories = {
    items: {
      roomExists: async () => true,
      insertItem: async (record: InsertInventoryItemRecord) => {
        inserted = {
          ...record,
          roomDesignation: "101",
          floorNumber: 1,
          buildingId: "building-1",
          buildingName: "Main",
          status: "active",
          qrCode: null,
          responsibleId: null,
          responsibleName: null,
          photoUrl: null,
          version: 1,
          createdAt: record.occurredAt,
          updatedAt: record.occurredAt,
          archivedAt: null,
        };
        return inserted;
      },
      insertItemQr: async () => undefined,
      appendAudit: async () => undefined,
    } as unknown as InventoryItemRepository,
  } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-08-06T12:00:00.000Z") },
    { create: () => "item-1" },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );

  await service.createItem({
    name: "Monitor",
    itemType: "Equipment",
    roomId: "11111111-1111-4111-8111-111111111111",
    barcode: " *2416/1056* ",
  }, { userId: "user-1", role: "admin" });

  assert.equal(inserted?.inventoryNumber, "2416/1056");
  assert.equal(inserted?.inventoryNumberKind, "official");
  assert.deepEqual(parseCode39ScanInput("*2416/1056*"), {
    ok: true,
    value: "2416/1056",
    inventoryNumber: "2416/1056",
    fallbackKey: null,
  });
});
