import assert from "node:assert/strict";
import test from "node:test";

import type {
  IdempotencyRequestInput,
  IdempotencyRequestRepository,
  IdempotencyResponse,
} from "../lib/application/ports/inventory-concurrency-repositories";
import type {
  BuildingRecord,
  InventoryLocationRepository,
  RoomRecord,
} from "../lib/application/ports/inventory-location-repositories";
import type { QrResolutionRecord } from "../lib/application/ports/qr-resolution-repositories";
import type {
  RoomWorkspaceItemRecord,
  RoomWorkspaceRecord,
} from "../lib/application/ports/room-workspace-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { executeIdempotentCommand } from "../lib/application/services/idempotent-command-service";
import { InventoryLocationService } from "../lib/application/services/inventory-location-service";
import { QrResolutionService } from "../lib/application/services/qr-resolution-service";
import { RoomWorkspaceService } from "../lib/application/services/room-workspace-service";
import { ApplicationError } from "../lib/domain/application-error";
import { qrIdentifierFromEntropy } from "../lib/domain/qr-identifier";

const ADMIN = { userId: "admin-1", role: "admin" } as const;
const WAREHOUSE = { userId: "warehouse-1", role: "warehouse" } as const;
const EMPLOYEE = { userId: "employee-1", role: "employee" } as const;
const QR_KEY = qrIdentifierFromEntropy(new Uint8Array(16));
const FIXED_DATE = new Date("2026-08-01T00:00:00.000Z");

function unitOfWork<Repositories>(repositories: Repositories): UnitOfWork<Repositories> {
  return {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
}

function rejectsWithCode(publicCode: string) {
  return (error: unknown) =>
    error instanceof ApplicationError && error.publicCode === publicCode;
}

const IDEMPOTENCY_INPUT: IdempotencyRequestInput = {
  actorId: ADMIN.userId,
  operation: "inventory.item.create",
  key: "request-key",
  requestHash: "request-hash",
  expiresInMs: 60_000,
  id: "request-1",
};

test("idempotent commands complete once and replay without rerunning work", async () => {
  const calls: string[] = [];
  let completed: { id: string; response: IdempotencyResponse } | undefined;
  const response = { body: { id: "item-1" }, resourceId: "item-1", status: 201 };
  const repository: IdempotencyRequestRepository = {
    reserve: async (input) => {
      calls.push(`reserve:${input.key}`);
      return { kind: "reserved", id: "reservation-1" };
    },
    complete: async (id, value) => {
      calls.push("complete");
      completed = { id, response: value };
    },
  };

  const result = await executeIdempotentCommand(
    unitOfWork({ idempotency: repository }),
    IDEMPOTENCY_INPUT,
    async () => {
      calls.push("work");
      return response;
    },
    { afterReserve: async () => { calls.push("after-reserve"); } },
  );

  assert.deepEqual(result, { kind: "completed", response });
  assert.deepEqual(calls, ["reserve:request-key", "after-reserve", "work", "complete"]);
  assert.deepEqual(completed, { id: "reservation-1", response });
});

test("idempotent commands replay and fail closed for in-progress or reused keys", async () => {
  let workCalls = 0;
  const replayResponse = { body: { id: "item-1" }, resourceId: "item-1", status: 200 };
  const repository: IdempotencyRequestRepository = {
    reserve: async () => ({ kind: "replay", response: replayResponse }),
    complete: async () => assert.fail("a replay must not complete again"),
  };
  const replay = await executeIdempotentCommand(
    unitOfWork({ idempotency: repository }),
    IDEMPOTENCY_INPUT,
    async () => {
      workCalls += 1;
      return replayResponse;
    },
  );
  assert.deepEqual(replay, { kind: "replayed", response: replayResponse });
  assert.equal(workCalls, 0);

  for (const kind of ["in_progress", "key_reused"] as const) {
    const failingRepository: IdempotencyRequestRepository = {
      reserve: async () => ({ kind }),
      complete: async () => assert.fail("a rejected reservation must not complete"),
    };
    await assert.rejects(
      executeIdempotentCommand(
        unitOfWork({ idempotency: failingRepository }),
        IDEMPOTENCY_INPUT,
        async () => replayResponse,
      ),
      rejectsWithCode(
        kind === "in_progress"
          ? "idempotency_request_in_progress"
          : "idempotency_key_reused",
      ),
    );
  }
});

test("idempotent command failure leaves the key retryable and never completes the failed attempt", async () => {
  let attempts = 0;
  let completeCalls = 0;
  let reservationAvailable = true;
  let completedResponse: IdempotencyResponse | undefined;
  const response = { body: { id: "item-1" }, resourceId: "item-1", status: 201 };
  const repository: IdempotencyRequestRepository = {
    reserve: async () => {
      if (completedResponse) return { kind: "replay", response: completedResponse };
      if (!reservationAvailable) return { kind: "in_progress" };
      reservationAvailable = false;
      return { kind: "reserved", id: "reservation-1" };
    },
    complete: async (_id, value) => {
      completeCalls += 1;
      completedResponse = value;
    },
  };
  const repositories: UnitOfWork<{ idempotency: IdempotencyRequestRepository }> = {
    read: async (work) => work({ idempotency: repository }),
    transaction: async (work) => {
      try {
        return await work({ idempotency: repository });
      } catch (error) {
        reservationAvailable = true;
        throw error;
      }
    },
  };

  await assert.rejects(
    executeIdempotentCommand(repositories, IDEMPOTENCY_INPUT, async () => {
      attempts += 1;
      throw new Error("transient mutation failure");
    }),
    /transient mutation failure/,
  );
  assert.equal(completeCalls, 0);

  const retry = await executeIdempotentCommand(
    repositories,
    IDEMPOTENCY_INPUT,
    async () => {
      attempts += 1;
      return response;
    },
  );
  assert.deepEqual(retry, { kind: "completed", response });
  assert.equal(attempts, 2);
  assert.equal(completeCalls, 1);
});

function qrRecord(overrides: Partial<QrResolutionRecord> = {}): QrResolutionRecord {
  return {
    canonicalKey: QR_KEY,
    format: "generated_v1",
    qrStatus: "active",
    targetKind: "item",
    targetId: "item-1",
    targetStatus: "active",
    title: "Projector",
    buildingName: "Main building",
    roomDesignation: "101",
    inventoryNumber: "INV-1",
    responsibleName: "Alice Employee",
    responsibleUserId: EMPLOYEE.userId,
    ...overrides,
  };
}

function qrService(record: QrResolutionRecord | null) {
  const queriedKeys: string[] = [];
  const repositories = {
    qr: {
      findByCanonicalKey: async (canonicalKey: string) => {
        queriedKeys.push(canonicalKey);
        return canonicalKey === record?.canonicalKey ? record : null;
      },
      findItemByBarcode: async (barcodeValue: string, inventoryNumberKey: string) => {
        const recordKey = record?.inventoryNumber
          ?.normalize("NFKC")
          .trim()
          .toLocaleLowerCase("ru-RU");
        return record?.targetKind === "item" &&
          (barcodeValue === record.inventoryNumber || inventoryNumberKey === recordKey)
          ? record
          : null;
      },
    },
  };
  return {
    service: new QrResolutionService(unitOfWork(repositories)),
    queriedKeys,
  };
}

test("QR resolution projects responsible data according to actor scope", async () => {
  const { service, queriedKeys } = qrService(qrRecord());

  const warehouseResult = await service.resolve(QR_KEY, WAREHOUSE);
  assert.deepEqual(queriedKeys, [QR_KEY]);
  assert.equal(warehouseResult.status, "resolved");
  assert.equal(warehouseResult.target?.responsibleName, "Alice Employee");

  const otherEmployeeResult = await service.resolve(QR_KEY, {
    userId: "employee-2",
    role: "employee",
  });
  assert.equal(otherEmployeeResult.target?.responsibleName, undefined);

  const ownerResult = await service.resolve(QR_KEY, EMPLOYEE);
  assert.equal(ownerResult.target?.responsibleName, "Alice Employee");
  assert.equal(ownerResult.target?.isCurrentUserResponsible, true);
});

test("QR resolution hides revoked or out-of-scope records and rejects malformed input", async () => {
  const revoked = await qrService(qrRecord({ qrStatus: "revoked" })).service.resolve(QR_KEY, EMPLOYEE);
  assert.equal(revoked.target, null);
  assert.equal(revoked.status, "unissued_system_code");

  const room = await qrService(qrRecord({ targetKind: "room", targetId: "room-1" })).service.resolve(
    QR_KEY,
    EMPLOYEE,
  );
  assert.equal(room.target, null);

  await assert.rejects(
    qrService(null).service.resolve("YUQ2:unsupported", ADMIN),
    rejectsWithCode("unsupported_qr_version"),
  );
});

function roomWorkspaceRecord(overrides: Partial<RoomWorkspaceRecord> = {}): RoomWorkspaceRecord {
  return {
    id: "room-1",
    designation: "101",
    buildingName: "Main building",
    floorNumber: 1,
    floorLabel: "First floor",
    primaryResponsibleId: EMPLOYEE.userId,
    primaryResponsibleName: "Alice Employee",
    ...overrides,
  };
}

function roomItem(overrides: Partial<RoomWorkspaceItemRecord> = {}): RoomWorkspaceItemRecord {
  return {
    id: "item-1",
    name: "Projector",
    inventoryNumber: "INV-1",
    description: "Portable projector",
    status: "active",
    condition: "good",
    connectionStatus: "connected",
    responsibleName: "Alice Employee",
    hasPhoto: true,
    createdAt: FIXED_DATE,
    ...overrides,
  };
}

function roomWorkspaceService(
  room: RoomWorkspaceRecord | null,
  items: RoomWorkspaceItemRecord[],
) {
  const repositories = {
    rooms: {
      findRoomById: async (id: string) => (id === room?.id ? room : null),
      findRoomByQr: async (canonicalKey: string) => (canonicalKey === QR_KEY ? room : null),
      listRoomItems: async (roomId: string) => (roomId === room?.id ? items : []),
    },
  };
  return new RoomWorkspaceService(unitOfWork(repositories));
}

test("room workspace separates public, limited and full projections", async () => {
  const roomId = "11111111-1111-4111-8111-111111111111";
  const service = roomWorkspaceService(roomWorkspaceRecord({ id: roomId }), [
    roomItem(),
    roomItem({ id: "item-2", connectionStatus: "disconnected", hasPhoto: false }),
  ]);

  assert.deepEqual(await service.findPublicByQr(QR_KEY), { designation: "101" });

  const limited = await service.findById(roomId, {
    userId: "employee-2",
    role: "employee",
  });
  assert.equal(limited.access, "limited");
  assert.deepEqual(limited.items, []);
  assert.equal("buildingName" in limited, false);

  const full = await service.findByQr(QR_KEY, EMPLOYEE);
  assert.equal(full.access, "full");
  assert.equal(full.itemCount, 2);
  assert.equal(full.connectedCount, 1);
  assert.equal(full.disconnectedCount, 1);
  assert.equal(full.items[0]?.photoUrl, "/api/inventory/items/item-1/photo");

  await assert.rejects(
    service.findById("not-a-uuid", EMPLOYEE),
    rejectsWithCode("invalid_id"),
  );
});

function building(overrides: Partial<BuildingRecord> = {}): BuildingRecord {
  return {
    id: "building-1",
    name: "Main building",
    nameKey: "main building",
    address: "Campus address",
    addressKey: "campus address",
    qrCode: QR_KEY,
    roomCount: 0,
    status: "active",
    version: 1,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function roomRecord(overrides: Partial<RoomRecord> = {}): RoomRecord {
  return {
    id: "room-1",
    buildingId: "building-1",
    designation: "101",
    designationKey: "101",
    floorNumber: 1,
    floorLabel: "First floor",
    primaryResponsibleId: EMPLOYEE.userId,
    primaryResponsibleName: "Alice Employee",
    qrCode: QR_KEY,
    status: "active",
    version: 1,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

function locationService(overrides: Partial<InventoryLocationRepository> = {}) {
  const repository = { ...overrides } as InventoryLocationRepository;
  let nextId = 0;
  return new InventoryLocationService(
    unitOfWork({ locations: repository }),
    { now: () => FIXED_DATE },
    { create: () => `generated-${++nextId}` },
    { create: () => new Uint8Array(16) },
  );
}

test("location service normalizes building creation and writes QR/audit in one workflow", async () => {
  let inserted: Record<string, unknown> | undefined;
  let insertedQr: Record<string, unknown> | undefined;
  let audit: Record<string, unknown> | undefined;
  const service = locationService({
    insertBuilding: async (input) => {
      inserted = input as unknown as Record<string, unknown>;
      return building({ id: input.id, name: input.name, address: input.address });
    },
    insertBuildingQr: async (input) => {
      insertedQr = input as unknown as Record<string, unknown>;
    },
    appendAudit: async (input) => {
      audit = input as unknown as Record<string, unknown>;
    },
  });

  const result = await service.createBuilding(
    { name: "  Main building ", address: "  Campus address " },
    ADMIN,
  );

  assert.equal(inserted?.name, "Main building");
  assert.equal(inserted?.address, "Campus address");
  assert.equal(inserted?.nameKey, "main building");
  assert.equal(inserted?.addressKey, "campus address");
  assert.equal(insertedQr?.value, result.qrCode);
  assert.match(result.qrCode, /^YUQ1:/);
  assert.equal(audit?.action, "building.created");
});

test("location service covers successful building and room mutation workflows", async () => {
  const actions: string[] = [];
  const service = locationService({
    findBuildingByIdForUpdate: async (id) => {
      assert.equal(id, "building-1");
      return building();
    },
    updateBuilding: async (input) => {
      assert.equal(input.id, "building-1");
      assert.equal(input.expectedVersion, 1);
      return building({ id: input.id, name: input.name, address: input.address, version: 2 });
    },
    countActiveRooms: async (buildingId) => {
      assert.equal(buildingId, "building-1");
      return 0;
    },
    archiveBuilding: async (input) => {
      assert.equal(input.id, "building-1");
      assert.equal(input.expectedVersion, 1);
      return building({ status: "archived", version: 2 });
    },
    insertRoom: async (input) =>
      (() => {
        assert.equal(input.buildingId, "building-1");
        return roomRecord({
          id: input.id,
          buildingId: input.buildingId,
          designation: input.designation,
          designationKey: input.designationKey,
          floorNumber: input.floorNumber,
          floorLabel: input.floorLabel,
          primaryResponsibleId: input.primaryResponsibleId,
        });
      })(),
    insertRoomQr: async () => undefined,
    findRoomByIdForUpdate: async (id) => {
      assert.equal(id, "room-1");
      return roomRecord();
    },
    updateRoom: async (input) =>
      (() => {
        assert.equal(input.id, "room-1");
        assert.equal(input.expectedVersion, 1);
        return roomRecord({
          id: input.id,
          designation: input.designation,
          designationKey: input.designationKey,
          floorNumber: input.floorNumber,
          floorLabel: input.floorLabel,
          primaryResponsibleId: input.primaryResponsibleId,
          version: 2,
        });
      })(),
    countActiveItems: async (roomId) => {
      assert.equal(roomId, "room-1");
      return 0;
    },
    archiveRoom: async (input) => {
      assert.equal(input.id, "room-1");
      assert.equal(input.expectedVersion, 1);
      return roomRecord({ status: "archived", version: 2 });
    },
    appendAudit: async (input) => { actions.push(input.action); },
  });

  const updatedBuilding = await service.updateBuilding(
    "building-1",
    { name: "Renamed", address: "New campus address", version: 1 },
    ADMIN,
  );
  assert.equal(updatedBuilding.name, "Renamed");
  await service.archiveBuilding("building-1", 1, ADMIN);

  const createdRoom = await service.createRoom(
    "building-1",
    { designation: " 102 ", floorNumber: 1, floorLabel: "First floor" },
    ADMIN,
  );
  assert.equal(createdRoom.designation, "102");
  const updatedRoom = await service.updateRoom(
    "room-1",
    { designation: "103", floorNumber: 1, floorLabel: "First floor", version: 1 },
    ADMIN,
  );
  assert.equal(updatedRoom.version, 2);
  await service.archiveRoom("room-1", 1, ADMIN);

  assert.deepEqual(actions, [
    "building.updated",
    "building.archived",
    "room.created",
    "room.updated",
    "room.archived",
  ]);
});

test("location service maps compare-and-swap failures to version conflicts", async () => {
  const buildingService = locationService({
    findBuildingByIdForUpdate: async () => building(),
    updateBuilding: async () => null,
  });
  await assert.rejects(
    buildingService.updateBuilding(
      "building-1",
      { name: "Main", address: "Campus", version: 1 },
      ADMIN,
    ),
    rejectsWithCode("version_conflict"),
  );

  const roomService = locationService({
    findRoomByIdForUpdate: async () => roomRecord(),
    updateRoom: async () => null,
  });
  await assert.rejects(
    roomService.updateRoom(
      "room-1",
      { designation: "101", floorNumber: 1, version: 1 },
      ADMIN,
    ),
    rejectsWithCode("version_conflict"),
  );
});

test("location service blocks unauthorized, stale and unsafe location mutations", async () => {
  const unauthorized = locationService();
  await assert.rejects(
    unauthorized.createBuilding({ name: "Main", address: "Campus" }, EMPLOYEE),
    rejectsWithCode("forbidden"),
  );
  await assert.rejects(
    unauthorized.createBuilding({ name: "", address: "Campus" }, ADMIN),
    rejectsWithCode("invalid_building_name"),
  );

  let updated = false;
  const stale = locationService({
    findBuildingByIdForUpdate: async () => building({ version: 2 }),
    updateBuilding: async () => {
      updated = true;
      return building({ version: 3 });
    },
  });
  await assert.rejects(
    stale.updateBuilding(
      "building-1",
      { name: "Main", address: "Campus", version: 1 },
      ADMIN,
    ),
    rejectsWithCode("version_conflict"),
  );
  assert.equal(updated, false);

  let archived = false;
  const occupied = locationService({
    findBuildingByIdForUpdate: async () => building(),
    countActiveRooms: async () => 1,
    archiveBuilding: async () => {
      archived = true;
      return building({ status: "archived", version: 2 });
    },
  });
  await assert.rejects(
    occupied.archiveBuilding("building-1", 1, ADMIN),
    rejectsWithCode("building_has_active_rooms"),
  );
  assert.equal(archived, false);
});
