import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { createPostgresInventoryItemRepositories } from "../lib/server/persistence/postgres/postgres-inventory-item-repositories";
import type { PostgresRepositorySource } from "../lib/server/persistence/postgres/postgres-unit-of-work";

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

test("a room-responsible employee can read only attachments below that readable item", async () => {
  const calls: string[][] = [];
  const service = createService({
    findItemById: async (id) =>
      id === ITEM_ID
        ? inventoryItem({ responsibleId: null, roomResponsibleId: EMPLOYEE_ID })
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

test("the PostgreSQL lookup binds attachment, comment, and item as one ancestry chain", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const source = {
    query: async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      const valid = values?.[0] === ATTACHMENT_ID &&
        values?.[1] === COMMENT_ID &&
        values?.[2] === ITEM_ID;
      return {
        rows: valid ? [attachmentRow()] : [],
        rowCount: valid ? 1 : 0,
      };
    },
  } as unknown as PostgresRepositorySource;
  const repository = createPostgresInventoryItemRepositories(source).items;

  assert.ok(
    await repository.findCommentAttachment(
      ITEM_ID,
      COMMENT_ID,
      ATTACHMENT_ID,
    ),
  );
  assert.equal(
    await repository.findCommentAttachment(
      OTHER_ITEM_ID,
      COMMENT_ID,
      ATTACHMENT_ID,
    ),
    null,
  );
  assert.equal(
    await repository.findCommentAttachment(
      ITEM_ID,
      OTHER_COMMENT_ID,
      ATTACHMENT_ID,
    ),
    null,
  );
  assert.equal(
    await repository.findCommentAttachment(
      ITEM_ID,
      COMMENT_ID,
      OTHER_ATTACHMENT_ID,
    ),
    null,
  );

  const query = calls[0]?.text ?? "";
  assert.match(query, /join\s+[^\n]+audit[^\n]+on\s+audit\.id\s*=\s*attachment\.comment_id/i);
  assert.match(query, /attachment\.id\s*=\s*\$1/i);
  assert.match(query, /attachment\.comment_id\s*=\s*\$2/i);
  assert.match(query, /audit\.subject_kind\s*=\s*'item'/i);
  assert.match(query, /audit\.subject_id\s*=\s*\$3/i);
  assert.match(query, /audit\.action\s*=\s*'item\.comment_added'/i);
  assert.deepEqual(calls[0]?.values, [ATTACHMENT_ID, COMMENT_ID, ITEM_ID]);
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

test("the route authenticates before lookup and serves only non-sniffable, non-cacheable downloads", () => {
  const route = readFileSync(
    "app/api/inventory/items/[id]/comments/[commentId]/attachments/[attachmentId]/route.ts",
    "utf8",
  );
  const nextConfig = readFileSync("next.config.ts", "utf8");

  assert.ok(route.indexOf("requireCurrentUser(request)") < route.indexOf("findCommentAttachment("));
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.match(route, /"content-disposition": attachmentDisposition\(attachment\.fileName\)/);
  assert.match(route, /"content-type": "application\/octet-stream"/);
  assert.match(route, /"x-content-type-options": "nosniff"/);
  assert.match(nextConfig, /source: "\/api\/:path\*"[\s\S]*?private, no-store, max-age=0, must-revalidate/);
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

function attachmentRow() {
  return {
    id: ATTACHMENT_ID,
    comment_id: COMMENT_ID,
    item_id: ITEM_ID,
    file_name: "evidence.txt",
    media_type: "text/plain",
    size_bytes: 8,
    binary_data: new TextEncoder().encode("evidence"),
    created_at: new Date("2026-08-14T08:00:00.000Z"),
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
