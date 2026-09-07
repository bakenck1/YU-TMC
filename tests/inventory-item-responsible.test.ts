import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
  InsertInventoryItemRecord,
} from "../lib/application/ports/inventory-item-repositories";
import type {
  AppendResponsibilityAuditRecord,
  InsertResponsibilityRecord,
  InventoryResponsibilityRepository,
  ItemResponsibilityState,
} from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryItemService } from "../lib/application/services/inventory-item-service";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const EMPLOYEE_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_EMPLOYEE_ID = "55555555-5555-4555-8555-555555555555";

function itemRecord(
  input: InsertInventoryItemRecord,
  responsibleId: string | null,
): InventoryItemRecord {
  return {
    ...input,
    roomDesignation: "101",
    floorNumber: 1,
    buildingId: "66666666-6666-4666-8666-666666666666",
    buildingName: "Main",
    status: "active",
    condition: "good",
    connectionStatus: "not_applicable",
    qrCode: null,
    responsibleId,
    responsibleName: responsibleId ? "Selected Employee" : null,
    photoUrl: null,
    version: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    archivedAt: null,
  };
}

test("creating an item assigns the selected active employee and audits it atomically", async () => {
  let record: InventoryItemRecord | null = null;
  let state: ItemResponsibilityState | null = null;
  const assignments: InsertResponsibilityRecord[] = [];
  const responsibilityAudits: AppendResponsibilityAuditRecord[] = [];
  const items = {
    roomExists: async () => true,
    insertItem: async (input: InsertInventoryItemRecord) => {
      record = itemRecord(input, null);
      state = {
        itemId: input.id,
        responsibilityPeriodId: null,
        responsibleUserId: null,
        responsibleName: null,
        itemStatus: "active",
      };
      return record;
    },
    findItemById: async () => record,
    insertItemQr: async () => undefined,
    appendAudit: async () => undefined,
  } as unknown as InventoryItemRepository;
  const responsibility = {
    findItemStateForUpdate: async () => state,
    findPendingTransfer: async () => null,
    findAuthorizationUserForUpdate: async (id: string) => ({
      id,
      role: "employee" as const,
      active: true,
      deletedAt: null,
      version: 1,
    }),
    insertResponsibility: async (input: InsertResponsibilityRecord) => {
      assignments.push(input);
      state = {
        itemId: input.itemId,
        responsibilityPeriodId: input.id,
        responsibleUserId: input.responsibleUserId,
        responsibleName: "Selected Employee",
        itemStatus: "active",
      };
      if (record) {
        record = {
          ...record,
          responsibleId: input.responsibleUserId,
          responsibleName: "Selected Employee",
        };
      }
    },
    appendAudit: async (input: AppendResponsibilityAuditRecord) => {
      responsibilityAudits.push(input);
    },
  } as unknown as InventoryResponsibilityRepository;
  const repositories = { items, responsibility } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  let idIndex = 0;
  const service = new InventoryItemService(
    unitOfWork,
    { now: () => new Date("2026-09-07T10:00:00.000Z") },
    { create: () => [ITEM_ID, "77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888", "99999999-9999-4999-8999-999999999999"][idIndex++]! },
    { create: () => new Uint8Array(16) },
    { next: () => "TMP-2026-1" },
  );

  const created = await service.createItem(
    {
      name: "Monitor",
      category: "electronics",
      roomId: ROOM_ID,
      barcode: "RESP-1001",
      responsibleUserId: EMPLOYEE_ID,
    },
    { userId: ADMIN_ID, role: "admin" },
  );

  assert.equal(created.responsible?.id, EMPLOYEE_ID);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0]?.source, "admin_override");
  assert.deepEqual(responsibilityAudits[0]?.afterValues, {
    responsibleUserId: EMPLOYEE_ID,
    source: "admin_override",
  });
});

test("changing the responsible person closes the old period before assigning the new employee", async () => {
  const now = new Date("2026-09-07T11:00:00.000Z");
  let record = itemRecord({
    id: ITEM_ID,
    name: "Monitor",
    description: null,
    itemType: "electronics",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 0,
    roomId: ROOM_ID,
    inventoryNumberKind: "temporary",
    inventoryNumber: "TMP-1",
    inventoryNumberKey: "TMP-1",
    actorId: ADMIN_ID,
    occurredAt: now,
  }, EMPLOYEE_ID);
  let state: ItemResponsibilityState = {
    itemId: ITEM_ID,
    responsibilityPeriodId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    responsibleUserId: EMPLOYEE_ID,
    responsibleName: "Old Employee",
    itemStatus: "active",
  };
  const calls: string[] = [];
  const items = {
    roomExists: async () => true,
    findItemById: async () => record,
    updateItemProtected: async () => {
      record = { ...record, version: 2 };
      return record;
    },
    appendAudit: async () => undefined,
  } as unknown as InventoryItemRepository;
  const responsibility = {
    findItemStateForUpdate: async () => state,
    findPendingTransfer: async () => null,
    findAuthorizationUserForUpdate: async (id: string) => ({ id, role: "employee" as const, active: true, deletedAt: null, version: 1 }),
    closeResponsibility: async () => {
      calls.push("close");
      return true;
    },
    insertResponsibility: async (input: InsertResponsibilityRecord) => {
      calls.push("insert");
      state = { ...state, responsibilityPeriodId: input.id, responsibleUserId: input.responsibleUserId };
      record = { ...record, responsibleId: input.responsibleUserId, responsibleName: "New Employee" };
    },
    appendAudit: async () => {
      calls.push("audit");
    },
  } as unknown as InventoryResponsibilityRepository;
  const repositories = { items, responsibility } satisfies InventoryItemRepositories;
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new InventoryItemService(
    unitOfWork,
    { now: () => now },
    { create: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { create: () => new Uint8Array(16) },
    { next: () => "TMP-1" },
  );

  const updated = await service.updateProtected(
    ITEM_ID,
    {
      version: 1,
      roomId: ROOM_ID,
      inventoryNumber: "TMP-1",
      status: "active",
      responsibleUserId: SECOND_EMPLOYEE_ID,
    },
    { userId: ADMIN_ID, role: "admin" },
  );

  assert.equal(updated.responsible?.id, SECOND_EMPLOYEE_ID);
  assert.deepEqual(calls, ["close", "insert", "audit"]);
});
