import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { toDecommissionedInventoryItemView } from "../lib/inventory-item-view";
import { canAccessPath } from "../lib/security/authorization";

const DECOMMISSIONED_ITEM: InventoryItemRecord = {
  id: "item-1",
  name: "Projector",
  description: null,
  itemType: "Projector",
  brand: "Epson",
  model: "EB-X49",
  quantity: 1,
  unitPrice: 100,
  roomId: "room-1",
  roomDesignation: "301",
  floorNumber: 3,
  buildingId: "building-1",
  buildingName: "Main",
  inventoryNumberKind: "official",
  inventoryNumber: "INV-42",
  status: "decommissioned",
  qrCode: null,
  responsibleId: "employee-1",
  responsibleName: "Employee",
  photoUrl: null,
  version: 2,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-15T10:30:00.000Z"),
  archivedAt: new Date("2026-07-14T09:00:00.000Z"),
};

function createService(
  itemMethods: Partial<InventoryItemRepository>,
): InventoryItemService {
  const repositories = {
    items: itemMethods as InventoryItemRepository,
  } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date() },
    { create: () => "id" },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );
}

test("lists all decommissioned items for an administrator and exposes archive time", async () => {
  let called = false;
  const service = createService({
    listDecommissionedItems: async () => {
      called = true;
      return [DECOMMISSIONED_ITEM];
    },
  });

  const result = await service.listDecommissionedItems({
    userId: "admin-1",
    role: "admin",
  });

  assert.equal(called, true);
  assert.equal(result[0]?.archivedAt, "2026-07-14T09:00:00.000Z");
  const view = toDecommissionedInventoryItemView(result[0]!);
  const localArchiveDate = new Date(result[0]!.archivedAt!);
  assert.equal(
    view.decommissionedOn,
    [
      localArchiveDate.getFullYear(),
      String(localArchiveDate.getMonth() + 1).padStart(2, "0"),
      String(localArchiveDate.getDate()).padStart(2, "0"),
    ].join("-"),
  );
});

test("warehouse can read the full decommissioned registry while employees receive only assigned records", async () => {
  let requestedAll = false;
  const service = createService({
    listDecommissionedItems: async () => {
      requestedAll = true;
      return [DECOMMISSIONED_ITEM];
    },
    listDecommissionedItemsAssignedTo: async () => [],
  });

  const employeeItems = await service.listDecommissionedItems({
    userId: "employee-1",
    role: "employee",
  });
  assert.deepEqual(employeeItems, []);
  const warehouseItems = await service.listDecommissionedItems({
    userId: "warehouse-1",
    role: "warehouse",
  });
  assert.deepEqual(warehouseItems.map((item) => item.id), ["item-1"]);
  assert.equal(requestedAll, true);
});

test("warehouse receives decommissioned items in the full main list", async () => {
  const activeItem = { ...DECOMMISSIONED_ITEM, id: "active-item", status: "active" as const };
  const service = createService({
    listItems: async () => [activeItem, DECOMMISSIONED_ITEM],
  });

  const result = await service.listItems({ userId: "warehouse-1", role: "warehouse" });

  assert.deepEqual(result.map((item) => item.id), ["active-item", "item-1"]);
});

test("warehouse can open a decommissioned item by direct link", async () => {
  const service = createService({
    findItemById: async () => DECOMMISSIONED_ITEM,
  });

  const item = await service.findItem("item-1", {
    userId: "warehouse-1",
    role: "warehouse",
  });
  assert.equal(item.id, "item-1");
});

test("lists protected-field audit snapshots only for administrators", async () => {
  const audit = {
    id: "audit-1",
    actorId: "admin-1",
    actorName: "Admin User",
    actorEmail: "admin@example.com",
    actorRole: "admin" as const,
    subjectRevision: 3,
    action: "item.protected_fields_updated",
    beforeValues: { status: "active", roomId: "room-1" },
    afterValues: { status: "maintenance", roomId: "room-2" },
    occurredAt: new Date("2026-07-30T12:00:00.000Z"),
  };
  const service = createService({
    findItemById: async () => DECOMMISSIONED_ITEM,
    listAudit: async () => [audit],
  });

  const result = await service.listAudit("item-1", {
    userId: "admin-1",
    role: "admin",
  });
  assert.deepEqual(result, [{
    id: audit.id,
    actorId: audit.actorId,
    actorName: audit.actorName,
    actorEmail: audit.actorEmail,
    actorRole: audit.actorRole,
    subjectRevision: audit.subjectRevision,
    action: audit.action,
    beforeValues: audit.beforeValues,
    afterValues: audit.afterValues,
    occurredAt: "2026-07-30T12:00:00.000Z",
  }]);
  await assert.rejects(
    service.listAudit("item-1", { userId: "warehouse-1", role: "warehouse" }),
    /forbidden/,
  );
});

test("records protected-field before and after snapshots with the acting administrator", async () => {
  let captured: Record<string, unknown> | undefined;
  const updated = {
    ...DECOMMISSIONED_ITEM,
    roomId: "22222222-2222-4222-8222-222222222222",
    status: "active" as const,
    version: DECOMMISSIONED_ITEM.version + 1,
  };
  const service = createService({
    findItemById: async () => DECOMMISSIONED_ITEM,
    roomExists: async () => true,
    updateItemProtected: async () => updated,
    appendAudit: async (record) => {
      captured = record as unknown as Record<string, unknown>;
    },
  });

  await service.updateProtected(
    "item-1",
    {
      version: DECOMMISSIONED_ITEM.version,
      roomId: "22222222-2222-4222-8222-222222222222",
      inventoryNumber: DECOMMISSIONED_ITEM.inventoryNumber,
      status: "active",
    },
    { userId: "admin-1", role: "admin" },
  );

  assert.equal(captured?.actorId, "admin-1");
  assert.equal(captured?.actorRole, "admin");
  assert.equal(captured?.action, "item.protected_fields_updated");
  assert.equal(captured?.subjectRevision, updated.version);
  assert.deepEqual(captured?.beforeValues, {
    roomId: DECOMMISSIONED_ITEM.roomId,
    roomLabel: `${DECOMMISSIONED_ITEM.buildingName}, ${DECOMMISSIONED_ITEM.roomDesignation}`,
    inventoryNumber: DECOMMISSIONED_ITEM.inventoryNumber,
    status: DECOMMISSIONED_ITEM.status,
    qrCode: DECOMMISSIONED_ITEM.qrCode,
  });
  assert.deepEqual(captured?.afterValues, {
    roomId: updated.roomId,
    roomLabel: `${updated.buildingName}, ${updated.roomDesignation}`,
    inventoryNumber: updated.inventoryNumber,
    status: updated.status,
    qrCode: updated.qrCode,
    qrReplaceReason: null,
  });
});

test("keeps a temporary number temporary when only protected status is changed", async () => {
  let protectedUpdate: Record<string, unknown> | undefined;
  const temporaryItem = {
    ...DECOMMISSIONED_ITEM,
    inventoryNumberKind: "temporary" as const,
    inventoryNumber: "TMP-2026-891668",
    status: "maintenance" as const,
  };
  const service = createService({
    findItemById: async () => temporaryItem,
    roomExists: async () => true,
    updateItemProtected: async (input) => {
      protectedUpdate = input as unknown as Record<string, unknown>;
      return { ...temporaryItem, status: "active" as const, version: 3 };
    },
    appendAudit: async () => undefined,
  });

  await service.updateProtected(
    "item-1",
    {
      version: temporaryItem.version,
      roomId: "22222222-2222-4222-8222-222222222222",
      inventoryNumber: temporaryItem.inventoryNumber,
      status: "active",
    },
    { userId: "admin-1", role: "admin" },
  );

  assert.equal(protectedUpdate?.inventoryNumberKind, "temporary");
  assert.equal(protectedUpdate?.status, "active");
});

test("casts protected status updates to the PostgreSQL enum consistently", () => {
  const repositorySource = readFileSync(
    "lib/server/persistence/postgres/postgres-inventory-item-repositories.ts",
    "utf8",
  );

  assert.match(
    repositorySource,
    /status = \$6::"yu_inventory"\."item_status"/,
  );
  assert.match(
    repositorySource,
    /when \$6::"yu_inventory"\."item_status" = 'decommissioned'/,
  );
});

test("operation feed uses historical room label snapshots without live-name fallback", () => {
  const repositorySource = readFileSync(
    "lib/server/persistence/postgres/postgres-inventory-item-repositories.ts",
    "utf8",
  );
  const operationQuery = repositorySource.slice(
    repositorySource.indexOf("async listOperations"),
    repositorySource.indexOf("async listComments"),
  );

  assert.match(operationQuery, /a\.before_values->>'roomLabel' as "fromLocation"/);
  assert.match(operationQuery, /a\.after_values->>'roomLabel' as "toLocation"/);
  assert.match(operationQuery, /and a\.action in \(/);
  assert.doesNotMatch(operationQuery, /'item\.comment_added'/);
  assert.doesNotMatch(operationQuery, /'item\.imported'/);
});

test("item detail UI wires photo modal and recent operation rendering", () => {
  const componentSource = readFileSync(
    "components/InventoryItemDetails.tsx",
    "utf8",
  );

  assert.match(componentSource, /const \[photoOpen, setPhotoOpen\] = useState\(false\)/);
  assert.match(
    componentSource,
    /lg:grid-cols-\[minmax\(420px,0\.95fr\)_minmax\(0,1\.5fr\)\]/,
  );
  assert.match(componentSource, /const photoDialogRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(componentSource, /const photoTriggerRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(componentSource, /const photoCloseButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(componentSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(componentSource, /previousActiveElement \?\? photoTrigger/);
  assert.match(componentSource, /event\.key === "Escape"/);
  assert.match(componentSource, /event\.key !== "Tab"/);
  assert.match(componentSource, /role="dialog"/);
  assert.match(componentSource, /ref=\{photoDialogRef\}/);
  assert.match(componentSource, /ref=\{photoCloseButtonRef\}/);
  assert.match(componentSource, /ref=\{photoTriggerRef\}/);
  assert.match(componentSource, /aria-label=\{t\("itemDetails\.photoFullSize"\)\}/);
  assert.match(componentSource, /onClick=\{\(\) => setPhotoOpen\(true\)\}/);
  assert.match(componentSource, /operations\.map\(\(entry\) =>/);
  assert.match(componentSource, /operationTitle\(entry, t\)/);
  assert.match(componentSource, /operationDetail\(entry, t\)/);
  assert.match(componentSource, /aria-labelledby="item-editor-title"/);
  assert.match(componentSource, /onClick=\{openContentEditor\}/);
  assert.match(componentSource, /ref=\{protectedTriggerRef\}/);
  assert.match(componentSource, /ref=\{protectedDialogRef\}/);
  assert.match(componentSource, /aria-labelledby="protected-fields-title"/);
  assert.match(componentSource, /t\("analytics\.buildingFilter"\)/);
  assert.match(componentSource, /protectedBuildingRooms\.map\(\(room\) =>/);
  assert.match(componentSource, /result\.response\.status === 409/);
  assert.match(componentSource, /latestResponse = await fetch/);
  assert.match(componentSource, /itemDetails\.errorInventoryNumber/);
  assert.match(componentSource, /itemDetails\.errorInvalidFields/);
  assert.match(componentSource, /h-\[208px\] w-full max-w-\[208px\]/);
  assert.match(componentSource, /sm:grid-cols-\[minmax\(0,1fr\)_190px\]/);
  assert.match(componentSource, /kind=qr&format=svg/);
  assert.match(componentSource, /<InventoryOverviewRow label=\{t\("items\.type"\)\}/);
  assert.doesNotMatch(componentSource, /id="item-information"/);
  assert.ok(
    componentSource.lastIndexOf("<InventoryItemComposition") <
      componentSource.indexOf('{t("itemDetails.recentOperations")}'),
    "composition should appear below the photo and code before the operation feed",
  );
});

test("archive route is visible to administrators and warehouse staff", () => {
  assert.equal(canAccessPath("admin", "/items/decommissioned"), true);
  assert.equal(canAccessPath("warehouse", "/items/decommissioned"), true);
  assert.equal(canAccessPath("employee", "/items/decommissioned"), false);
  assert.equal(canAccessPath("owner", "/items/decommissioned"), false);
});
