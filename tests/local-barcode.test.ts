import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  InsertLocalBarcodeGroup,
  LocalBarcodeActorRecord,
  LocalBarcodeEventRecord,
  LocalBarcodeGroupRecord,
  LocalBarcodeRepositories,
  LocalBarcodeRepository,
} from "../lib/application/ports/local-barcode-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { LocalBarcodeService } from "../lib/application/services/local-barcode-service";
import { parseCode39ScanInput, renderCode39Svg } from "../lib/domain/code39";
import {
  buildLocalBarcode,
  formatLocalBarcodeSuffix,
  localBarcodeComparisonKey,
} from "../lib/domain/local-barcode";

const ITEM_ID = "10000000-0000-4000-8000-000000000001";
const ADMIN_ID = "10000000-0000-4000-8000-000000000002";
const OWNER_ID = "10000000-0000-4000-8000-000000000003";
const USER_B_ID = "10000000-0000-4000-8000-000000000004";
const USER_C_ID = "10000000-0000-4000-8000-000000000005";
const ROOM_A_ID = "10000000-0000-4000-8000-000000000006";
const ROOM_B_ID = "10000000-0000-4000-8000-000000000007";
const ROOM_C_ID = "10000000-0000-4000-8000-000000000008";

test("local Code 39 values use a global non-truncating suffix", () => {
  assert.equal(formatLocalBarcodeSuffix(1), "0001");
  assert.equal(formatLocalBarcodeSuffix(9999), "9999");
  assert.equal(formatLocalBarcodeSuffix(10000), "10000");
  assert.equal(buildLocalBarcode("1234/5678", 1), "1234/5678-0001");
  assert.equal(localBarcodeComparisonKey(" 1234/5678-0001 "), "1234/5678-0001");
  assert.deepEqual(parseCode39ScanInput("*1234/5678-0001*"), {
    ok: true,
    value: "1234/5678-0001",
    inventoryNumber: "1234/5678-0001",
    fallbackKey: null,
  });
});

test("local label contains the item, quantity and responsible employee", () => {
  const svg = renderCode39Svg("1234/5678-0001", {
    footerLines: ["Стул", "Количество: 5", "Ответственный: Сотрудник Б"],
  });
  assert.match(svg, /1234\/5678-0001/);
  assert.match(svg, /Стул/);
  assert.match(svg, /Количество: 5/);
  assert.match(svg, /Ответственный: Сотрудник Б/);
});

test("partial local transfer keeps the old code, whole transfer keeps its code, and cancellation restores the parent", async () => {
  const actors = new Map<string, LocalBarcodeActorRecord>([
    [ADMIN_ID, actor(ADMIN_ID, "admin")],
    [OWNER_ID, actor(OWNER_ID, "employee")],
    [USER_B_ID, actor(USER_B_ID, "employee")],
    [USER_C_ID, actor(USER_C_ID, "employee")],
  ]);
  const recipients = new Map([
    [USER_B_ID, recipient(USER_B_ID, "Сотрудник Б", ROOM_B_ID)],
    [USER_C_ID, recipient(USER_C_ID, "Сотрудник В", ROOM_C_ID)],
  ]);
  const groups = new Map<string, LocalBarcodeGroupRecord>();
  const events: LocalBarcodeEventRecord[] = [];
  const item = {
    id: ITEM_ID,
    name: "Стул",
    inventoryNumber: "1234/5678",
    quantity: 10,
    version: 1,
    status: "active" as const,
    responsibleUserId: OWNER_ID,
    responsibleName: "Сотрудник А",
    roomId: ROOM_A_ID,
    roomDesignation: "101",
    buildingId: "10000000-0000-4000-8000-000000000009",
    buildingName: "Корпус",
  };
  let sequence = BigInt(0);

  const repository: LocalBarcodeRepository = {
    findActorForUpdate: async (id) => actors.get(id) ?? null,
    findRecipientForUpdate: async (id) => recipients.get(id) ?? null,
    findItemForUpdate: async (id) => (id === item.id ? { ...item } : null),
    findItem: async (id) => (id === item.id ? { ...item } : null),
    findGroupForUpdate: async (id) => groups.get(id) ?? null,
    findGroup: async (id) => groups.get(id) ?? null,
    findGroupByBarcodeKey: async (key) =>
      [...groups.values()].find((group) => group.barcodeKey === key) ?? null,
    listGroups: async (itemId) =>
      [...groups.values()].filter((group) => group.itemId === itemId),
    listEvents: async (groupId) => events.filter((event) => event.id.startsWith(groupId)),
    allocatedQuantity: async () =>
      [...groups.values()]
        .filter((group) => group.status === "active")
        .reduce((total, group) => total + group.quantity, 0),
    isBarcodeRegistered: async (key) =>
      [...groups.values()].some((group) => group.barcodeKey === key),
    advanceItemVersion: async (_id, version) => {
      if (version !== item.version) return false;
      item.version += 1;
      return true;
    },
    nextSequence: async () => {
      sequence += BigInt(1);
      return sequence;
    },
    insertGroup: async (input) => {
      groups.set(input.id, groupFromInsert(input, recipients));
    },
    reduceGroupQuantity: async (id, version, quantity) => {
      const group = groups.get(id);
      if (!group || group.version !== version || group.quantity <= quantity) return false;
      group.quantity -= quantity;
      group.version += 1;
      return true;
    },
    increaseGroupQuantity: async (id, quantity) => {
      const group = groups.get(id);
      if (!group || group.status !== "active") return false;
      group.quantity += quantity;
      group.version += 1;
      return true;
    },
    transferWholeGroup: async (input) => {
      const group = groups.get(input.id);
      if (!group || group.version !== input.version || group.status !== "active") return false;
      const target = recipients.get(input.responsibleUserId)!;
      group.responsibleUserId = input.responsibleUserId;
      group.responsibleName = target.fullName;
      group.roomId = input.roomId;
      group.roomDesignation = input.roomId === ROOM_B_ID ? "202" : "303";
      group.transferredAt = input.transferredAt;
      group.version += 1;
      return true;
    },
    cancelGroup: async (input) => {
      const group = groups.get(input.id);
      if (!group || group.version !== input.version || group.status !== "active") return false;
      group.status = "cancelled";
      group.cancelledBy = input.cancelledBy;
      group.cancelledByName = "Администратор";
      group.cancelledAt = input.cancelledAt;
      group.cancellationReason = input.reason;
      group.version += 1;
      return true;
    },
    countActiveChildren: async (id) =>
      [...groups.values()].filter(
        (group) => group.parentGroupId === id && group.status === "active",
      ).length,
    insertEvent: async (input) => {
      events.push({
        ...input,
        id: `${input.groupId}:${events.length}`,
        actorName: actors.get(input.actorId)?.role ?? "actor",
        fromResponsibleName: input.fromResponsibleUserId,
        toResponsibleName: input.toResponsibleUserId,
        roomDesignation: "room",
        buildingId: "building",
        buildingName: "building",
      });
    },
    appendAudit: async () => undefined,
  };
  const repositories = {
    localBarcodes: repository,
    idempotency: {} as LocalBarcodeRepositories["idempotency"],
  };
  const unitOfWork = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  } as UnitOfWork<LocalBarcodeRepositories>;
  let idCounter = 20;
  const service = new LocalBarcodeService(
    unitOfWork,
    { now: () => new Date("2026-08-31T12:00:00.000Z") },
    {
      create: () =>
        `10000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`,
    },
  );

  const first = await service.transfer(
    {
      itemId: ITEM_ID,
      sourceGroupId: null,
      recipientUserId: USER_B_ID,
      quantity: 5,
      sourceVersion: 1,
    },
    { userId: OWNER_ID, role: "employee", sessionVersion: 1 },
  );
  assert.equal(first.group.localBarcode, "1234/5678-0001");
  assert.equal(first.createdNewCode, true);

  const second = await service.transfer(
    {
      itemId: ITEM_ID,
      sourceGroupId: first.group.id,
      recipientUserId: USER_C_ID,
      quantity: 2,
      sourceVersion: first.group.version,
    },
    { userId: USER_B_ID, role: "employee", sessionVersion: 1 },
  );
  assert.equal(second.group.localBarcode, "1234/5678-0002");
  assert.equal(groups.get(first.group.id)?.quantity, 3);

  const movedWhole = await service.transfer(
    {
      itemId: ITEM_ID,
      sourceGroupId: second.group.id,
      recipientUserId: USER_B_ID,
      quantity: 2,
      sourceVersion: second.group.version,
    },
    { userId: USER_C_ID, role: "employee", sessionVersion: 1 },
  );
  assert.equal(movedWhole.createdNewCode, false);
  assert.equal(movedWhole.group.localBarcode, second.group.localBarcode);
  assert.equal(sequence, BigInt(2));

  await service.cancel(
    second.group.id,
    { version: movedWhole.group.version, reason: "Ошибочная передача" },
    { userId: ADMIN_ID, role: "admin", sessionVersion: 1 },
  );
  assert.equal(groups.get(second.group.id)?.status, "cancelled");
  assert.equal(groups.get(first.group.id)?.quantity, 5);

  const distribution = await service.getDistribution(ITEM_ID, {
    userId: ADMIN_ID,
    role: "admin",
  });
  assert.equal(distribution.originalRemainder, 5);
  assert.equal(
    distribution.originalRemainder +
      distribution.groups
        .filter((group) => group.status === "active")
        .reduce((total, group) => total + group.quantity, 0),
    distribution.originalQuantity,
  );

  await service.cancel(
    first.group.id,
    {
      version: groups.get(first.group.id)!.version,
      reason: "Возврат исходной группы",
    },
    { userId: ADMIN_ID, role: "admin", sessionVersion: 1 },
  );
  const restored = await service.getDistribution(ITEM_ID, {
    userId: ADMIN_ID,
    role: "admin",
  });
  assert.equal(restored.originalRemainder, 10);
  assert.equal(restored.originalVersion, 3);
});

test("migration reserves a global namespace, preserves cancelled codes and defers quantity checks", async () => {
  const migration = await readFile(
    "drizzle/20260831130000_local_item_barcodes.sql",
    "utf8",
  );
  assert.match(migration, /CREATE SEQUENCE .*local_barcode_sequence/);
  assert.match(migration, /CREATE TABLE .*barcode_registry/);
  assert.match(migration, /local_item_groups_barcode_registry_insert/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /status = 'cancelled'/);
  assert.doesNotMatch(migration, /DELETE FROM .*local_item_groups/i);
});

function actor(
  id: string,
  role: LocalBarcodeActorRecord["role"],
): LocalBarcodeActorRecord {
  return { id, role, active: true, deletedAt: null, version: 1 };
}

function recipient(id: string, fullName: string, defaultRoomId: string) {
  return {
    id,
    fullName,
    role: "employee" as const,
    active: true,
    deletedAt: null,
    defaultRoomId,
    roomActive: true,
  };
}

function groupFromInsert(
  input: InsertLocalBarcodeGroup,
  recipients: Map<string, ReturnType<typeof recipient>>,
): LocalBarcodeGroupRecord {
  const target = recipients.get(input.responsibleUserId)!;
  return {
    id: input.id,
    itemId: input.itemId,
    itemName: "Стул",
    originalBarcode: "1234/5678",
    parentGroupId: input.parentGroupId,
    sequenceNumber: input.sequenceNumber,
    barcodeValue: input.barcodeValue,
    barcodeKey: input.barcodeKey,
    quantity: input.quantity,
    responsibleUserId: input.responsibleUserId,
    responsibleName: target.fullName,
    roomId: input.roomId,
    roomDesignation: input.roomId === ROOM_B_ID ? "202" : "303",
    buildingId: "10000000-0000-4000-8000-000000000009",
    buildingName: "Корпус",
    previousResponsibleUserId: input.previousResponsibleUserId,
    previousRoomId: input.previousRoomId,
    createdBy: input.createdBy,
    createdAt: input.occurredAt,
    transferredAt: input.occurredAt,
    status: "active",
    cancelledBy: null,
    cancelledByName: null,
    cancelledAt: null,
    cancellationReason: null,
    version: 1,
  };
}
