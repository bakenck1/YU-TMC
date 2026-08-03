import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryItemCommentRecord,
  InventoryItemRecord,
  InventoryItemOperationRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
} from "../lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
] as const;
const OTHER_ROOM_ID = "33333333-3333-4333-8333-333333333333";

function item(id: string, responsibleId: string | null = null): InventoryItemRecord {
  return {
    id,
    name: id === IDS[0] ? "Комплект" : "Монитор",
    description: null,
    itemType: "Оборудование",
    brand: "Brand",
    model: null,
    quantity: 1,
    unitPrice: 10,
    roomId: IDS[0],
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: IDS[0],
    buildingName: "Корпус",
    inventoryNumberKind: "official",
    inventoryNumber: `INV-${id.slice(0, 4)}`,
    status: "active",
    qrCode: null,
    responsibleId,
    responsibleName: responsibleId ? "Employee" : null,
    photoUrl: null,
    version: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    archivedAt: null,
  };
}

function createService(methods: Partial<InventoryItemRepository>) {
  const repositories = { items: methods as InventoryItemRepository } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  let sequence = 0;
  let entropySequence = 0;
  return new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-08-01T12:00:00.000Z") },
    { create: () => `audit-${++sequence}` },
    {
      create: () => {
        const bytes = new Uint8Array(16);
        bytes[15] = ++entropySequence;
        return bytes;
      },
    },
    { next: () => "TEMP-1" },
  );
}

test("adds a canonical undirected component relation and audits both items", async () => {
  const records = [item(IDS[0]), item(IDS[1])];
  let inserted: Record<string, unknown> | undefined;
  const audits: Record<string, unknown>[] = [];
  const service = createService({
    findItemById: async (id) => records.find((value) => value.id === id) ?? null,
    insertComponent: async (value) => {
      inserted = value as unknown as Record<string, unknown>;
    },
    listComponents: async () => [records[1]],
    appendAudit: async (value) => {
      audits.push(value as unknown as Record<string, unknown>);
    },
  });

  const result = await service.addComponent(IDS[1].toUpperCase(), IDS[0], {
    userId: IDS[0],
    role: "admin",
  });

  assert.equal(inserted?.leftItemId, IDS[0]);
  assert.equal(inserted?.rightItemId, IDS[1]);
  assert.equal(result[0]?.id, IDS[1]);
  assert.deepEqual(audits.map((audit) => audit.subjectId).sort(), [...IDS].sort());
  assert.ok(audits.every((audit) => audit.action === "item.component_added"));
});

test("component mutations are administrator-only and reject self-links", async () => {
  const service = createService({
    findItemById: async (id) => item(id),
  });
  await assert.rejects(
    service.addComponent(IDS[0], IDS[1], { userId: "w", role: "warehouse" }),
    /forbidden/,
  );
  await assert.rejects(
    service.addComponent(IDS[0], IDS[0], { userId: IDS[0], role: "admin" }),
    /item_cannot_contain_itself/,
  );
});

test("employee sees every linked item because all staff can view the full registry", async () => {
  const current = item(IDS[0], "employee-1");
  const assigned = item(IDS[1], "employee-1");
  const other = { ...item("33333333-3333-4333-8333-333333333333"), responsibleId: "employee-2" };
  const service = createService({
    findItemById: async () => current,
    listComponents: async () => [assigned, other],
  });
  const result = await service.listComponents(IDS[0], {
    userId: "employee-1",
    role: "employee",
  });
  assert.deepEqual(result.map((value) => value.id), [IDS[1], other.id]);
});

test("removes the canonical relation and records before-value audits", async () => {
  const records = [item(IDS[0]), item(IDS[1])];
  let deleted: Record<string, unknown> | undefined;
  const audits: Record<string, unknown>[] = [];
  const service = createService({
    findItemById: async (id) => records.find((value) => value.id === id) ?? null,
    deleteComponent: async (value) => {
      deleted = value as unknown as Record<string, unknown>;
      return true;
    },
    listComponents: async () => [],
    appendAudit: async (value) => {
      audits.push(value as unknown as Record<string, unknown>);
    },
  });

  const result = await service.removeComponent(IDS[1], IDS[0], {
    userId: IDS[0],
    role: "admin",
  });

  assert.equal(deleted?.leftItemId, IDS[0]);
  assert.equal(deleted?.rightItemId, IDS[1]);
  assert.deepEqual(result, []);
  assert.ok(audits.every((audit) => audit.action === "item.component_removed"));
  assert.ok(audits.every((audit) => audit.beforeValues));
});

test("reports a missing relation without writing an audit", async () => {
  const records = [item(IDS[0]), item(IDS[1])];
  let auditCount = 0;
  const service = createService({
    findItemById: async (id) => records.find((value) => value.id === id) ?? null,
    deleteComponent: async () => false,
    appendAudit: async () => {
      auditCount += 1;
    },
  });

  await assert.rejects(
    service.removeComponent(IDS[0], IDS[1], {
      userId: IDS[0],
      role: "admin",
    }),
    /item_component_not_found/,
  );
  assert.equal(auditCount, 0);
});

test("does not add a decommissioned item to a composition", async () => {
  const active = item(IDS[0]);
  const decommissioned = { ...item(IDS[1]), status: "decommissioned" as const };
  let insertCount = 0;
  const service = createService({
    findItemById: async (id) =>
      [active, decommissioned].find((value) => value.id === id) ?? null,
    insertComponent: async () => {
      insertCount += 1;
    },
  });

  await assert.rejects(
    service.addComponent(IDS[0], IDS[1], {
      userId: IDS[0],
      role: "admin",
    }),
    /item_component_decommissioned/,
  );
  assert.equal(insertCount, 0);
});

test("searches a bounded candidate list for administrators", async () => {
  const current = item(IDS[0]);
  const candidate = item(IDS[1]);
  let search: { itemId: string; query: string; limit: number } | undefined;
  const service = createService({
    findItemById: async () => current,
    searchComponentCandidates: async (itemId, query, limit) => {
      search = { itemId, query, limit };
      return [candidate];
    },
  });

  const result = await service.searchComponentCandidates(
    IDS[0].toUpperCase(),
    "  Monitor  ",
    { userId: IDS[0], role: "admin" },
  );

  assert.deepEqual(search, { itemId: IDS[0], query: "Monitor", limit: 50 });
  assert.equal(result[0]?.id, IDS[1]);
  await assert.rejects(
    service.searchComponentCandidates(IDS[0], "x".repeat(101), {
      userId: IDS[0],
      role: "admin",
    }),
    /item_component_query_too_long/,
  );
});

test("lists a merged operation feed with actor contact and safe component detail", async () => {
  const current = item(IDS[0], "employee-1");
  const operations: InventoryItemOperationRecord[] = [
    {
      id: "audit-component",
      kind: "item",
      action: "item.component_added",
      actorName: "Admin User",
      actorEmail: "admin@example.com",
      targetName: null,
      occurredAt: new Date("2026-08-01T12:00:00.000Z"),
      beforeValues: null,
      afterValues: {
        componentName: "Monitor",
        componentInventoryNumber: "INV-2222",
        protectedValue: "must not leave the service",
      },
    },
    {
      id: "audit-transfer",
      kind: "transfer",
      action: "transfer.confirmed",
      actorName: null,
      actorEmail: null,
      targetName: "Employee User",
      occurredAt: new Date("2026-08-01T11:00:00.000Z"),
      beforeValues: { status: "pending_current_owner" },
      afterValues: {
        status: "confirmed",
        administrativeReason: "secret admin reason",
        decisionComment: "private transfer comment",
        detail: "private responsibility detail",
      },
    },
    {
      id: "audit-location",
      kind: "item",
      action: "item.protected_fields_updated",
      actorName: "Admin User",
      actorEmail: "admin@example.com",
      targetName: null,
      occurredAt: new Date("2026-08-01T10:00:00.000Z"),
      beforeValues: { roomId: IDS[1] },
      afterValues: { roomId: OTHER_ROOM_ID, status: "maintenance" },
      fromLocation: "Корпус A (101)",
      toLocation: "Корпус B (202)",
    },
    {
      id: "audit-override-release",
      kind: "transfer",
      action: "transfer.overridden",
      actorName: "Admin User",
      actorEmail: "admin@example.com",
      targetName: null,
      occurredAt: new Date("2026-08-01T09:00:00.000Z"),
      beforeValues: { status: "pending_current_owner" },
      afterValues: { status: "overridden", outcome: "released" },
    },
  ];
  const service = createService({
    findItemById: async () => current,
    listOperations: async () => operations,
  });

  const result = await service.listOperations(IDS[0], {
    userId: "employee-1",
    role: "employee",
  });

  assert.equal(result.length, 4);
  assert.equal(result[0]?.actorEmail, "admin@example.com");
  assert.deepEqual(result[0]?.detail, { componentName: "Monitor" });
  assert.equal(result[1]?.actorName, null);
  assert.equal(result[1]?.detail?.comment, "private transfer comment");
  assert.deepEqual(result[2]?.detail, {
    status: "maintenance",
    fromRoomId: IDS[1],
    toRoomId: OTHER_ROOM_ID,
    fromLocation: "Корпус A (101)",
    toLocation: "Корпус B (202)",
  });
  assert.equal(result[3]?.detail?.outcome, "released");

  const adminResult = await service.listOperations(IDS[0], {
    userId: IDS[0],
    role: "admin",
  });
  assert.deepEqual(adminResult[0]?.detail, {
    componentName: "Monitor",
    componentInventoryNumber: "INV-2222",
  });
  assert.equal(adminResult[0]?.detail && "protectedValue" in adminResult[0].detail, false);
  assert.equal(adminResult[1]?.detail?.comment, "private transfer comment");
  assert.deepEqual(adminResult[2]?.detail, {
    status: "maintenance",
    fromRoomId: IDS[1],
    toRoomId: OTHER_ROOM_ID,
    fromLocation: "Корпус A (101)",
    toLocation: "Корпус B (202)",
  });
  assert.equal(adminResult[3]?.detail?.outcome, "released");

  const warehouseResult = await service.listOperations(IDS[0], {
    userId: "warehouse-1",
    role: "warehouse",
  });
  assert.equal(warehouseResult[0]?.detail?.componentInventoryNumber, undefined);
  assert.equal(warehouseResult[1]?.detail?.comment, undefined);
  assert.equal(warehouseResult[0]?.actorEmail, null);
});

test("administrator and employee can add normalized item comments while warehouse cannot", async () => {
  const current = item(IDS[0]);
  const comments: InventoryItemCommentRecord[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const service = createService({
    findItemById: async () => current,
    appendAudit: async (record) => {
      audits.push(record as unknown as Record<string, unknown>);
      const values = record.afterValues as { message: string };
      comments.unshift({
        id: record.id,
        authorName: "Employee User",
        authorEmail: "employee@example.com",
        message: values.message,
        createdAt: record.occurredAt,
      });
    },
    listComments: async () => comments,
  });

  const result = await service.addComment(IDS[0], "  Checked\r\nonsite  ", {
    userId: "employee-1",
    role: "employee",
  });
  assert.equal(result[0]?.message, "Checked\r\nonsite");
  assert.equal(audits[0]?.action, "item.comment_added");
  assert.deepEqual(audits[0]?.afterValues, { message: "Checked\r\nonsite" });
  await assert.rejects(
    service.addComment(IDS[0], "Warehouse note", {
      userId: "warehouse-1",
      role: "warehouse",
    }),
    /forbidden/,
  );
  const warehouseComments = await service.listComments(IDS[0], {
    userId: "warehouse-1",
    role: "warehouse",
  });
  assert.equal(warehouseComments.length, 1);
  await assert.rejects(
    service.addComment(IDS[0], "   ", {
      userId: "employee-1",
      role: "employee",
    }),
    /invalid_comment/,
  );
});

test("comment attachments are normalized, stored atomically, and exposed to readers", async () => {
  const current = item(IDS[0]);
  const audits: Array<Record<string, unknown>> = [];
  const attachments: Array<Record<string, unknown>> = [];
  const service = createService({
    findItemById: async () => current,
    appendAudit: async (record) => audits.push(record as unknown as Record<string, unknown>),
    insertCommentAttachment: async (record) => attachments.push(record as unknown as Record<string, unknown>),
    listComments: async () => [{
      id: String(audits[0]?.id ?? "comment-1"),
      authorName: "Employee",
      authorEmail: "employee@example.com",
      message: "See attached",
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
      attachment: attachments[0]
        ? { id: String(attachments[0].id), fileName: String(attachments[0].fileName), mediaType: String(attachments[0].mediaType), sizeBytes: Number(attachments[0].sizeBytes) }
        : null,
    }],
  });
  const result = await service.addComment(IDS[0], "See attached", { userId: "employee-1", role: "employee" }, {
    fileName: "../evidence.txt",
    mediaType: "text/plain",
    binaryData: new TextEncoder().encode("evidence"),
  });
  assert.equal(attachments[0]?.fileName, "evidence.txt");
  assert.equal(attachments[0]?.sizeBytes, 8);
  assert.equal(result[0]?.attachment?.fileName, "evidence.txt");
  await assert.rejects(service.addComment(IDS[0], "bad", { userId: "employee-1", role: "employee" }, {
    fileName: "payload.html",
    mediaType: "text/html",
    binaryData: new Uint8Array([1]),
  }), /invalid_comment_attachment/);
});

test("bulk import creates all items in one unit of work with distinct identifiers and audits", async () => {
  const inserted: InventoryItemRecord[] = [];
  const qrValues = new Set<string>();
  const audits: Array<Record<string, unknown>> = [];
  const service = createService({
    roomExists: async () => true,
    insertItem: async (record) => {
      const created = {
        ...item(record.id),
        ...record,
        roomDesignation: "101",
        floorNumber: 1,
        buildingId: IDS[0],
        buildingName: "Main",
        qrCode: null,
        responsibleId: null,
        responsibleName: null,
        photoUrl: null,
        version: 1,
        createdAt: record.occurredAt,
        updatedAt: record.occurredAt,
        archivedAt: null,
      } satisfies InventoryItemRecord;
      inserted.push(created);
      return created;
    },
    insertItemQr: async (record) => {
      qrValues.add(record.value);
    },
    appendAudit: async (record) => {
      audits.push(record as unknown as Record<string, unknown>);
    },
  });

  const result = await service.importItems([
    { name: "Monitor", itemType: "Equipment", quantity: 1, unitPrice: 10, roomId: IDS[0] },
    { name: "Desk", itemType: "Furniture", quantity: 2, unitPrice: 20, roomId: IDS[0] },
  ], { userId: IDS[0], role: "admin" });

  assert.equal(result.length, 2);
  assert.equal(new Set(inserted.map((record) => record.inventoryNumber)).size, 2);
  assert.equal(qrValues.size, 2);
  assert.deepEqual(audits.map((record) => record.action), ["item.imported", "item.imported"]);
  await assert.rejects(
    service.importItems([
      { name: "No access", itemType: "Equipment", roomId: IDS[0] },
    ], { userId: "employee-1", role: "employee" }),
    /forbidden/,
  );
});
