import assert from "node:assert/strict";
import test from "node:test";

import type {
InventoryItemRecord,
InventoryItemRepositories,
InventoryItemRepository,
StoredInventoryItemCommentAttachment,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";
import { ApplicationError } from "../lib/domain/application-error";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ITEM_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_COMMENT_ID = "44444444-4444-4444-8444-444444444444";
const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ATTACHMENT_ID = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_EMPLOYEE_ID = "88888888-8888-4888-8888-888888888888";

test("an employee cannot discover a known attachment below an unassigned parent item", async () => {
  let attachmentLookups = 0;
  const service = createService({
    findItemById: async () => inventoryItem({ responsibleId: OTHER_EMPLOYEE_ID }),
    findCommentAttachment: async () => {
      attachmentLookups += 1;
      return storedAttachment();
    },
  });

  await assert.rejects(
    service.findCommentAttachment(ITEM_ID, COMMENT_ID, ATTACHMENT_ID, {
      userId: EMPLOYEE_ID,
      role: "employee",
    }),
    itemNotFound,
  );
  assert.equal(
    attachmentLookups,
    0,
    "the binary lookup must not run after parent-item authorization fails",
  );
});

test("an employee can read only attachments below an item in an open room", async () => {
  const calls: string[][] = [];
  const service = createService({
    findItemById: async (id) =>
      id === ITEM_ID
        ? inventoryItem({
            responsibleId: null,
            roomResponsibleId: EMPLOYEE_ID,
            roomAccessMode: "open",
          })
        : null,
    findCommentAttachment: async (itemId, commentId, attachmentId) => {
      calls.push([itemId, commentId, attachmentId]);
      return itemId === ITEM_ID &&
        commentId === COMMENT_ID &&
        attachmentId === ATTACHMENT_ID
        ? storedAttachment()
        : null;
    },
  });

  const attachment = await service.findCommentAttachment(
    ITEM_ID.toUpperCase(),
    COMMENT_ID.toUpperCase(),
    ATTACHMENT_ID.toUpperCase(),
    { userId: EMPLOYEE_ID, role: "employee" },
  );
  assert.equal(attachment.id, ATTACHMENT_ID);
  assert.deepEqual(calls[0], [ITEM_ID, COMMENT_ID, ATTACHMENT_ID]);

  await assert.rejects(
    service.findCommentAttachment(
      ITEM_ID,
      OTHER_COMMENT_ID,
      ATTACHMENT_ID,
      { userId: EMPLOYEE_ID, role: "employee" },
    ),
    attachmentNotFound,
  );
  await assert.rejects(
    service.findCommentAttachment(
      ITEM_ID,
      COMMENT_ID,
      OTHER_ATTACHMENT_ID,
      { userId: EMPLOYEE_ID, role: "employee" },
    ),
    attachmentNotFound,
  );
});

test("malformed path identifiers fail before any item or binary lookup", async () => {
  let lookups = 0;
  const service = createService({
    findItemById: async () => {
      lookups += 1;
      return inventoryItem();
    },
    findCommentAttachment: async () => {
      lookups += 1;
      return storedAttachment();
    },
  });
  const actor = { userId: EMPLOYEE_ID, role: "employee" as const };

  for (const [itemId, commentId, attachmentId] of [
    ["../etc/passwd", COMMENT_ID, ATTACHMENT_ID],
    [ITEM_ID, "not-a-comment-uuid", ATTACHMENT_ID],
    [ITEM_ID, COMMENT_ID, "not-an-attachment-uuid"],
  ]) {
    await assert.rejects(
      service.findCommentAttachment(itemId, commentId, attachmentId, actor),
      validationError,
    );
  }
  assert.equal(lookups, 0);
});

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
    { now: () => new Date("2026-08-14T08:00:00.000Z") },
    { create: () => OTHER_ATTACHMENT_ID },
    { create: () => new Uint8Array(16) },
    { next: () => "TEMP-1" },
  );
}

function inventoryItem(
  overrides: Partial<InventoryItemRecord> = {},
): InventoryItemRecord {
  return {
    id: ITEM_ID,
    name: "Laptop",
    description: null,
    itemType: "Equipment",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 1,
    roomId: OTHER_ITEM_ID,
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: OTHER_ITEM_ID,
    buildingName: "Main",
    inventoryNumberKind: "official",
    inventoryNumber: "INV-1",
    status: "active",
    qrCode: null,
    responsibleId: EMPLOYEE_ID,
    responsibleName: "Employee",
    roomResponsibleId: null,
    photoUrl: null,
    version: 1,
    createdAt: new Date("2026-08-14T08:00:00.000Z"),
    updatedAt: new Date("2026-08-14T08:00:00.000Z"),
    archivedAt: null,
    ...overrides,
  };
}

function storedAttachment(): StoredInventoryItemCommentAttachment {
  return {
    id: ATTACHMENT_ID,
    commentId: COMMENT_ID,
    itemId: ITEM_ID,
    fileName: "evidence.txt",
    mediaType: "text/plain",
    sizeBytes: 8,
    binaryData: new TextEncoder().encode("evidence"),
    createdAt: new Date("2026-08-14T08:00:00.000Z"),
  };
}

function applicationError(
  error: unknown,
  kind: ApplicationError["kind"],
  publicCode?: string,
) {
  return error instanceof ApplicationError &&
    error.kind === kind &&
    (publicCode === undefined || error.publicCode === publicCode);
}

const itemNotFound = (error: unknown) =>
  applicationError(error, "not_found", "item_not_found");
const attachmentNotFound = (error: unknown) =>
  applicationError(error, "not_found", "attachment_not_found");
const validationError = (error: unknown) =>
  applicationError(error, "validation");
