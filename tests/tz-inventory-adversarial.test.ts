import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { InventoryItemDto } from "../lib/contracts/inventory-items";
import type {
  LocalBarcodeGroupRecord,
  LocalBarcodeRepositories,
  LocalBarcodeRepository,
} from "../lib/application/ports/local-barcode-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import {
  applyApprovedLocalBarcodeTransfer,
  LocalBarcodeService,
} from "../lib/application/services/local-barcode-service";
import type {
  BuildingDto,
  RoomDto,
} from "../lib/contracts/inventory-locations";
import { buildCampusMapData } from "../lib/campus-map-data";
import { translate } from "../lib/i18n";
import { filterInventoryItems } from "../lib/inventory-list";
import { summarizeInventory } from "../lib/inventory-summary";
import { toLocalBarcodeInventoryItem } from "../lib/local-barcode-item-view";
import { defaultPathForRole } from "../lib/security/authorization";
import { createPostgresTmcOperationRepositories } from "../lib/server/persistence/postgres/postgres-tmc-operation-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";
import type { InventoryItem } from "../lib/types";
import {
  ACTOR,
  RECIPIENT_ID,
  candidate,
  createHarness,
  uuid,
} from "./support/tmc-transfer-request-harness";

const SUMMARY_BASE: InventoryItem = {
  id: "active",
  name: "Projector",
  inventoryNumber: "INV-1",
  category: "electronics",
  location: "The Main Campus / 1 floor / 101",
  responsible: "Employee",
  status: "active",
  photoColor: "#000",
  quantity: 3,
  price: 100,
};

test("TZ 5.2: summary uses quantities and includes every lifecycle status in total value", () => {
  const items: InventoryItem[] = [
    SUMMARY_BASE,
    {
      ...SUMMARY_BASE,
      id: "maintenance",
      status: "maintenance",
      quantity: 2,
      price: 50,
    },
    {
      ...SUMMARY_BASE,
      id: "decommissioned",
      status: "decommissioned",
      quantity: 10,
      price: 7,
    },
    {
      ...SUMMARY_BASE,
      id: "decommissioned-in-use",
      status: "decommissioned_in_use",
      quantity: 4,
      price: 11,
    },
  ];

  assert.deepEqual(summarizeInventory(items), {
    totalValue: 514,
    totalItems: 19,
    maintenance: 2,
    // This metric deliberately counts cards, unlike the two quantity metrics.
    decommissioned: 2,
  });
});

test("TZ 5.3: choosing an exact responsible does not include a different person whose name has that prefix", () => {
  const exact = { ...SUMMARY_BASE, id: "exact-owner", responsible: "Alex Kim" };
  const prefixCollision = {
    ...SUMMARY_BASE,
    id: "different-owner",
    responsible: "Alex Kim Jr",
  };

  const filtered = filterInventoryItems([exact, prefixCollision], {
    query: "",
    category: "all",
    location: "all",
    room: "",
    statusKey: "all",
    brand: "",
    model: "",
    itemType: "",
    building: "",
    responsible: "Alex Kim",
  });

  assert.deepEqual(filtered.map((item) => item.id), ["exact-owner"]);
});

test("administrators and warehouse users assigned to inventory are found by the ordinary responsible filter", () => {
  const administratorItem = {
    ...SUMMARY_BASE,
    id: "admin-owned",
    responsible: "Aruzhan Admin",
  };
  const warehouseItem = {
    ...SUMMARY_BASE,
    id: "warehouse-owned",
    responsible: "Wali Warehouse",
  };
  const employeeItem = {
    ...SUMMARY_BASE,
    id: "employee-owned",
    responsible: "Employee User",
  };

  const items = [administratorItem, warehouseItem, employeeItem];
  const filters = {
    query: "",
    category: "all" as const,
    location: "all" as const,
    room: "",
    statusKey: "all" as const,
    brand: "",
    model: "",
    itemType: "",
    building: "",
  };

  assert.deepEqual(
    filterInventoryItems(items, {
      ...filters,
      responsible: "Aruzhan Admin",
    }).map((item) => item.id),
    ["admin-owned"],
  );
  assert.deepEqual(
    filterInventoryItems(items, {
      ...filters,
      responsible: "Wali Warehouse",
    }).map((item) => item.id),
    ["warehouse-owned"],
  );
});

test("TZ 3.1: every role has /items as its ordinary post-login destination", () => {
  for (const role of ["admin", "warehouse", "employee"] as const) {
    assert.equal(defaultPathForRole(role), "/items", role);
  }
});

test("TZ 3.2: the sidebar omits Profile while the header avatar remains a direct /profile link", async () => {
  const [sidebar, header] = await Promise.all([
    readFile(new URL("../components/SidebarContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Header.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(sidebar, /href:\s*["']\/profile["']/);
  assert.match(header, /<Link\s+href=["']\/profile["']/);
  assert.match(
    header,
    /<Link\s+href=["']\/profile["']\s+aria-label=\{t\(["']nav\.profile["']\)\}/,
  );
});

test("TZ 5.5: floor and room filter labels no longer expose the old compound location names", () => {
  assert.equal(translate("ru", "items.filterFloor"), "Этаж");
  assert.equal(translate("ru", "items.filterRoom"), "Кабинет");
  assert.equal(translate("kk", "items.filterFloor"), "Қабат");
  assert.equal(translate("kk", "items.filterRoom"), "Кабинет");
  assert.equal(translate("en", "items.filterFloor"), "Floor");
  assert.equal(translate("en", "items.filterRoom"), "Room");
});

test("TZ 4.2/8.6: the server accepts maintenance and decommissioned-in-use transfers but rejects final write-offs", async () => {
  const allowedStatuses = ["maintenance", "decommissioned_in_use"] as const;
  for (const [index, status] of allowedStatuses.entries()) {
    const itemId = uuid(index + 1);
    const harness = createHarness({
      candidates: [candidate(itemId, { itemStatus: status })],
    });

    const result = await harness.service.create(
      { recipientId: RECIPIENT_ID, itemIds: [itemId] },
      ACTOR,
    );

    assert.equal(result.included, 1, status);
    assert.equal(result.items[0]?.outcome, "included", status);
  }

  const itemId = uuid(20);
  const harness = createHarness({
    candidates: [candidate(itemId, { itemStatus: "decommissioned" })],
  });
  const rejected = await harness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [itemId] },
    ACTOR,
  );
  assert.deepEqual(rejected.items, [
    { itemId, outcome: "problem", problem: "item_inactive" },
  ]);

  const archivedId = uuid(21);
  const archivedHarness = createHarness({
    candidates: [candidate(archivedId, {
      itemStatus: "active",
      archivedAt: new Date("2026-09-18T08:00:00.000Z"),
    })],
  });
  const archived = await archivedHarness.service.create(
    { recipientId: RECIPIENT_ID, itemIds: [archivedId] },
    ACTOR,
  );
  assert.deepEqual(archived.items, [
    { itemId: archivedId, outcome: "problem", problem: "item_inactive" },
  ]);
});

test("TZ 4.2/8.6: PostgreSQL creation and acceptance CAS also allow both transferable non-active statuses", async () => {
  for (const status of ["maintenance", "decommissioned_in_use"] as const) {
    const createdAt = new Date("2026-09-18T08:00:00.000Z");
    const insert = insertRequestItemInput(createdAt);
    const insertSource = queuedSource([{
      rows: [{
        id: insert.id,
        request_id: insert.requestId,
        item_id: insert.itemId,
        responsibility_period_id_at_request: insert.responsibilityPeriodIdAtRequest,
        current_responsible_id_at_request: insert.currentResponsibleIdAtRequest,
        requested_quantity: null,
        source_local_group_id: null,
        source_version: null,
        result: "pending",
        invalid_reason: null,
        created_at: createdAt,
        decided_at: null,
        decided_by: null,
        version: 1,
        item_exists: true,
        item_status: status,
        archived_at: null,
        item_version: insert.expectedItemVersion,
        expected_period_open: true,
      }],
    }]);
    const insertRepository = createPostgresTmcOperationRepositories(
      insertSource.source,
    ).transferRequests;

    assert.equal(
      (await insertRepository.insertRequestItem(insert)).result,
      "pending",
      `atomic insert rejected ${status}`,
    );

    const decisionSource = queuedSource([
      { rows: [{ version: 1, result: "pending" }] },
      { rows: [{ status, archived_at: null }] },
      {
        rows: [{
          id: insert.responsibilityPeriodIdAtRequest,
          item_id: insert.itemId,
          responsible_user_id: insert.currentResponsibleIdAtRequest,
          ended_at: null,
        }],
      },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    const decisionRepository = createPostgresTmcOperationRepositories(
      decisionSource.source,
    ).transferRequests;

    assert.equal(
      await decisionRepository.decideItem({
        requestId: insert.requestId,
        requestItemId: insert.id,
        itemId: insert.itemId,
        responsibilityPeriodIdAtRequest: insert.responsibilityPeriodIdAtRequest,
        currentResponsibleIdAtRequest: insert.currentResponsibleIdAtRequest,
        expectedVersion: 1,
        decision: "accept",
        recipientId: uuid(33),
        decidedBy: uuid(33),
        decidedAt: createdAt,
        newResponsibilityPeriodId: uuid(34),
      }),
      "accepted",
      `acceptance invalidated ${status}`,
    );
  }
});

test("TZ 2/4.1/4.2: local barcode groups preserve lifecycle status and can transfer unless finally written off", async () => {
  const ownerId = ACTOR.userId;
  const recipientId = RECIPIENT_ID;
  const group = localGroupRecord("maintenance", ownerId);
  const readRepository = {
    listActiveGroupsAssignedTo: async () => [group],
  } as unknown as LocalBarcodeRepository;
  const readUnitOfWork = {
    read: (work) => work({ localBarcodes: readRepository }),
  } as UnitOfWork<LocalBarcodeRepositories>;
  const service = new LocalBarcodeService(
    readUnitOfWork,
    { now: () => new Date("2026-09-18T08:00:00.000Z") },
    { create: () => uuid(60) },
  );

  const listed = await service.listActiveGroupsAssignedTo({
    userId: ownerId,
    role: "employee",
  });
  assert.equal(listed[0]?.itemStatus, "maintenance");
  assert.equal(toLocalBarcodeInventoryItem(listed[0]!).status, "maintenance");

  for (const status of ["maintenance", "decommissioned_in_use"] as const) {
    let inserted: LocalBarcodeGroupRecord | null = null;
    const item = {
      id: uuid(61),
      name: "Shared chairs",
      inventoryNumber: "123/456",
      quantity: 5,
      version: 1,
      status,
      responsibleUserId: ownerId,
      responsibleName: "Owner",
      roomId: uuid(62),
      roomDesignation: "101",
      buildingId: uuid(63),
      buildingName: "The Main Campus",
      itemSection: "general" as const,
    };
    const mutationRepository = {
      findRecipientForUpdate: async () => ({
        id: recipientId,
        fullName: "Recipient",
        role: "employee" as const,
        active: true,
        deletedAt: null,
        defaultRoomId: uuid(64),
        roomActive: true,
      }),
      findItemForUpdate: async () => item,
      allocatedQuantity: async () => 0,
      nextSequence: async () => 1n,
      isBarcodeRegistered: async () => false,
      advanceItemVersion: async () => true,
      insertGroup: async (input) => {
        inserted = {
          ...localGroupRecord(status, recipientId),
          id: input.id,
          itemId: input.itemId,
          parentGroupId: input.parentGroupId,
          sequenceNumber: input.sequenceNumber,
          barcodeValue: input.barcodeValue,
          barcodeKey: input.barcodeKey,
          quantity: input.quantity,
          responsibleUserId: input.responsibleUserId,
          roomId: input.roomId,
          previousResponsibleUserId: input.previousResponsibleUserId,
          previousRoomId: input.previousRoomId,
          createdBy: input.createdBy,
          createdAt: input.occurredAt,
          transferredAt: input.occurredAt,
        };
      },
      findGroup: async () => inserted,
      insertEvent: async () => undefined,
      appendAudit: async () => undefined,
    } as unknown as LocalBarcodeRepository;

    const result = await applyApprovedLocalBarcodeTransfer(
      mutationRepository,
      {
        itemId: item.id,
        sourceGroupId: null,
        recipientUserId: recipientId,
        quantity: 2,
        sourceVersion: 1,
        comment: null,
        initiator: { id: ownerId, role: "employee" },
        occurredAt: new Date("2026-09-18T08:00:00.000Z"),
      },
      { create: () => uuid(65) },
    );
    assert.equal(result.group.quantity, 2, status);
  }
});

test("TZ 4.2: QR resolution does not relabel a local group from a written-off item as active", async () => {
  const route = await readFile(
    new URL("../app/api/inventory/qr/resolve/route.ts", import.meta.url),
    "utf8",
  );
  const localGroupTarget = route.slice(
    route.indexOf("if (localGroup)"),
    route.indexOf("const resolution = await", route.indexOf("if (localGroup)")),
  );

  assert.doesNotMatch(localGroupTarget, /status:\s*["']active["']/);
  assert.match(localGroupTarget, /localGroup\.itemStatus/);
});

test("TZ 6.1/6.3: campus projection preserves the real photo and distinguishes both write-off statuses", () => {
  const building: BuildingDto = {
    id: "building-1",
    name: "The Main Campus",
    address: "Campus",
    qrCode: "building-qr",
    roomCount: 1,
    status: "active",
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const room: RoomDto = {
    id: "room-1",
    buildingId: building.id,
    designation: "101",
    floorNumber: 1,
    floorLabel: null,
    qrCode: "room-qr",
    status: "active",
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const base = campusItem("item-decommissioned", "decommissioned", "/api/inventory/items/item-decommissioned/photo");
  const inUse = campusItem("item-in-use", "decommissioned_in_use", "/api/inventory/items/item-in-use/photo");
  const map = buildCampusMapData([building], [room], [base, inUse]);
  const mappedFinal = map.itemsById[base.id]!;
  const mappedInUse = map.itemsById[inUse.id]!;

  assert.equal(
    (mappedFinal as unknown as { photoUrl?: string | null }).photoUrl,
    base.photoUrl,
  );
  assert.equal(
    (mappedInUse as unknown as { photoUrl?: string | null }).photoUrl,
    inUse.photoUrl,
  );
  assert.notEqual(
    String(mappedFinal.status),
    String(mappedInUse.status),
    "decommissioned_in_use must not collapse into the final write-off badge",
  );
});

test("TZ 6.2/6.4: campus item card has a real Code 39 path, no decorative QR, and modal back navigation", async () => {
  const [card, map] = await Promise.all([
    readFile(new URL("../components/CampusItemCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/CampusMap.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(card, /buildQrMatrix|QR_SIZE/);
  assert.match(card, /code39|barcode/i);
  assert.match(card, /photoUrl/);
  assert.match(card, /onClick|<a\b/);
  assert.match(map, /map\.back/);
  assert.match(map, /view\s*===\s*["']item["'][\s\S]*setView\(["']floor["']\)/);
  assert.match(map, /view\s*===\s*["']floor["'][\s\S]*setView\(["']building["']\)/);
});

function campusItem(
  id: string,
  status: InventoryItemDto["status"],
  photoUrl: string,
): InventoryItemDto {
  return {
    id,
    name: `Item ${id}`,
    description: null,
    category: "electronics",
    itemType: "electronics",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 100,
    inventoryNumberKind: "permanent",
    inventoryNumber: `INV-${id}`,
    room: {
      id: "room-1",
      designation: "101",
      floorNumber: 1,
      buildingId: "building-1",
      buildingName: "The Main Campus",
    },
    status,
    qrCode: null,
    responsible: { id: ACTOR.userId, name: "Employee" },
    photoUrl,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
  };
}

function insertRequestItemInput(createdAt: Date) {
  return {
    id: uuid(30),
    requestId: uuid(31),
    itemId: uuid(32),
    expectedItemVersion: 7,
    responsibilityPeriodIdAtRequest: uuid(35),
    currentResponsibleIdAtRequest: ACTOR.userId,
    createdAt,
  };
}

function queuedSource(
  responses: Array<{ rows: unknown[]; rowCount?: number }>,
) {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const source = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      const response = responses.shift();
      if (!response) throw new Error("unexpected_query");
      return {
        command: "SELECT",
        fields: [],
        oid: 0,
        rowCount: response.rowCount ?? response.rows.length,
        rows: response.rows,
      };
    },
  } as unknown as PostgresRepositorySource;
  return { source, calls };
}

function localGroupRecord(
  itemStatus: LocalBarcodeGroupRecord["itemStatus"],
  responsibleUserId: string,
): LocalBarcodeGroupRecord {
  return {
    id: uuid(50),
    itemId: uuid(51),
    itemName: "Shared chairs",
    itemStatus,
    originalBarcode: "123/456",
    itemType: "furniture",
    itemBrand: null,
    itemModel: null,
    itemDescription: null,
    unitPrice: 100,
    itemPhotoId: null,
    parentGroupId: null,
    sequenceNumber: 1n,
    barcodeValue: "123/456-0001",
    barcodeKey: "123/456-0001",
    quantity: 2,
    responsibleUserId,
    responsibleName: "Owner",
    roomId: uuid(52),
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: uuid(53),
    buildingName: "The Main Campus",
    previousResponsibleUserId: null,
    previousResponsibleName: null,
    previousRoomId: null,
    createdBy: responsibleUserId,
    createdAt: new Date("2026-09-18T08:00:00.000Z"),
    transferredAt: new Date("2026-09-18T08:00:00.000Z"),
    status: "active",
    cancelledBy: null,
    cancelledByName: null,
    cancelledAt: null,
    cancellationReason: null,
    version: 1,
    itemSection: "general",
  };
}
