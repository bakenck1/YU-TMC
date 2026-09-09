import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppendItemAuditRecord,
  InsertInventoryItemCommentAttachmentRecord,
  InventoryItemRecord,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import {
  InventoryItemCommentService,
  type InventoryItemCommentRepositories,
} from "../lib/application/services/inventory-item-comment-service";

const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ATTACHMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("comment extraction keeps audit and attachment in one rollback boundary", async () => {
  const order: string[] = [];
  const committedAudits: AppendItemAuditRecord[] = [];
  const committedAttachments: InsertInventoryItemCommentAttachmentRecord[] = [];
  let rolledBack = false;

  const unitOfWork: UnitOfWork<InventoryItemCommentRepositories> = {
    read: async (work) => work(createRepositories(committedAudits, committedAttachments)),
    transaction: async (work) => {
      const stagedAudits = [...committedAudits];
      const stagedAttachments = [...committedAttachments];
      const repositories = createRepositories(stagedAudits, stagedAttachments, order, true);
      try {
        const result = await work(repositories);
        committedAudits.splice(0, committedAudits.length, ...stagedAudits);
        committedAttachments.splice(0, committedAttachments.length, ...stagedAttachments);
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  };
  const service = new InventoryItemCommentService(
    unitOfWork,
    { now: () => new Date("2026-09-09T08:00:00.000Z") },
    { create: sequenceIds([COMMENT_ID, ATTACHMENT_ID]) },
  );

  await assert.rejects(
    service.addComment(
      ITEM_ID,
      "  Evidence attached  ",
      { userId: EMPLOYEE_ID, role: "employee" },
      {
        fileName: "evidence.txt",
        mediaType: "text/plain",
        binaryData: new TextEncoder().encode("evidence"),
      },
    ),
    /attachment write failed/,
  );

  assert.deepEqual(order, ["find-item", "append-audit", "insert-attachment"]);
  assert.equal(rolledBack, true);
  assert.deepEqual(committedAudits, []);
  assert.deepEqual(committedAttachments, []);
});

test("move-only extraction preserves the facade UUID normalization contract", async () => {
  const calls: string[][] = [];
  const repositories = createRepositories([], []);
  repositories.items.findItemById = async (id) => {
    calls.push([id]);
    return item();
  };
  repositories.items.findCommentAttachment = async (itemId, commentId, attachmentId) => {
    calls.push([itemId, commentId, attachmentId]);
    return {
      id: ATTACHMENT_ID,
      commentId: COMMENT_ID,
      itemId: ITEM_ID,
      fileName: "evidence.txt",
      mediaType: "text/plain",
      sizeBytes: 8,
      binaryData: new TextEncoder().encode("evidence"),
      createdAt: new Date("2026-09-09T08:00:00.000Z"),
    };
  };
  const unitOfWork: UnitOfWork<InventoryItemCommentRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new InventoryItemCommentService(
    unitOfWork,
    { now: () => new Date("2026-09-09T08:00:00.000Z") },
    { create: sequenceIds([COMMENT_ID]) },
  );

  await service.findCommentAttachment(
    ITEM_ID.toUpperCase(),
    COMMENT_ID.toUpperCase(),
    ATTACHMENT_ID.toUpperCase(),
    { userId: EMPLOYEE_ID, role: "employee" },
  );
  assert.deepEqual(calls, [
    [ITEM_ID],
    [ITEM_ID, COMMENT_ID.toUpperCase(), ATTACHMENT_ID.toUpperCase()],
  ]);
  await assert.rejects(
    service.listComments("aaaaaaaa-aaaa-6aaa-8aaa-aaaaaaaaaaaa", {
      userId: EMPLOYEE_ID,
      role: "employee",
    }),
    /invalid_id/,
  );
});

function createRepositories(
  audits: AppendItemAuditRecord[],
  attachments: InsertInventoryItemCommentAttachmentRecord[],
  order: string[] = [],
  failAttachment = false,
): InventoryItemCommentRepositories {
  return {
    items: {
      findItemById: async () => {
        order.push("find-item");
        return item();
      },
      appendAudit: async (record) => {
        order.push("append-audit");
        audits.push(record);
      },
      insertCommentAttachment: async (record) => {
        order.push("insert-attachment");
        attachments.push(record);
        if (failAttachment) throw new Error("attachment write failed");
      },
      listComments: async () => [],
      findCommentAttachment: async () => null,
    },
  };
}

function sequenceIds(values: readonly string[]) {
  let index = 0;
  return () => {
    const value = values[index++];
    if (!value) throw new Error("unexpected id request");
    return value;
  };
}

function item(): InventoryItemRecord {
  return {
    id: ITEM_ID,
    name: "Laptop",
    description: null,
    itemType: "electronics",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 100,
    roomId: "55555555-5555-4555-8555-555555555555",
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: "66666666-6666-4666-8666-666666666666",
    buildingName: "Main",
    inventoryNumberKind: "official",
    inventoryNumber: "INV-1",
    status: "active",
    qrCode: null,
    responsibleId: EMPLOYEE_ID,
    responsibleName: "Employee",
    roomResponsibleId: null,
    photoUrl: null,
    version: 7,
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    updatedAt: new Date("2026-09-01T08:00:00.000Z"),
    archivedAt: null,
  };
}
