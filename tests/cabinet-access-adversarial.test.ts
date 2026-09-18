import assert from "node:assert/strict";
import test from "node:test";

import type {
  RoomWorkspaceItemRecord,
  RoomWorkspaceRecord,
  RoomWorkspaceRepositories,
} from "../lib/application/ports/room-workspace-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { RoomWorkspaceService } from "../lib/application/services/room-workspace-service";
import { qrIdentifierFromEntropy } from "../lib/domain/qr-identifier";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_ID = "33333333-3333-4333-8333-333333333333";
const QR_KEY = qrIdentifierFromEntropy(new Uint8Array(16));

const ADMIN = { userId: "44444444-4444-4444-8444-444444444444", role: "admin" } as const;
const WAREHOUSE = { userId: "55555555-5555-4555-8555-555555555555", role: "warehouse" } as const;
const OWNER = { userId: OWNER_ID, role: "employee" } as const;
const OUTSIDER = { userId: OUTSIDER_ID, role: "employee" } as const;

test("closed cabinet never serializes foreign item data for an employee who owns one item", async () => {
  const service = workspaceService(room("closed"), [
    item({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Owner monitor",
      inventoryNumber: "PRIVATE-OWNER-INV",
      responsibleUserId: OWNER_ID,
      responsibleName: "Owner Employee",
    }),
    item({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Foreign system unit",
      inventoryNumber: "SECRET-FOREIGN-INV",
      description: "SECRET-FOREIGN-DESCRIPTION",
      responsibleUserId: OUTSIDER_ID,
      responsibleName: "Secret Foreign Employee",
    }),
  ]);

  const direct = await service.findById(ROOM_ID, OWNER);
  const scanned = await service.findByQr(QR_KEY, OWNER);

  assert.deepEqual(direct, scanned, "direct-ID and QR paths must use exactly the same scope");
  assert.equal(direct.access, "limited");
  assert.equal(direct.items.length, 1);
  assert.equal(direct.items[0]?.inventoryNumber, "PRIVATE-OWNER-INV");
  const serialized = JSON.stringify(direct);
  assert.doesNotMatch(serialized, /SECRET-FOREIGN-INV/);
  assert.doesNotMatch(serialized, /SECRET-FOREIGN-DESCRIPTION/);
  assert.doesNotMatch(serialized, /Secret Foreign Employee/);
  assert.doesNotMatch(serialized, /Foreign system unit/);
});

test("closed cabinet denial is non-enumerable and leaks no cabinet metadata", async () => {
  const service = workspaceService(room("closed"), [
    item({ responsibleUserId: OWNER_ID, responsibleName: "Owner Employee" }),
  ]);

  for (const denied of [
    await service.findById(ROOM_ID, OUTSIDER),
    await service.findByQr(QR_KEY, OUTSIDER),
  ]) {
    const serialized = JSON.stringify(denied);
    assert.doesNotMatch(serialized, /TOP-SECRET-ROOM/);
    assert.doesNotMatch(serialized, /SECRET-BUILDING/);
    assert.doesNotMatch(serialized, /Primary Responsible/);
    assert.doesNotMatch(serialized, /INV-1/);
    assert.doesNotMatch(serialized, /Owner Employee/);
  }

  const unauthenticated = await service.findPublicByQr(QR_KEY);
  assert.doesNotMatch(
    JSON.stringify(unauthenticated),
    /TOP-SECRET-ROOM|SECRET-BUILDING|Primary Responsible/,
    "a closed cabinet must not disclose its designation before authentication",
  );
});

test("legacy primary-responsible metadata cannot grant full access to a closed cabinet", async () => {
  const primaryResponsibleId = "66666666-6666-4666-8666-666666666666";
  const service = workspaceService(room("closed"), [
    item({
      inventoryNumber: "FOREIGN-INV-VISIBLE-ONLY-TO-ITS-OWNER",
      responsibleUserId: OWNER_ID,
    }),
  ]);

  const result = await service.findById(ROOM_ID, {
    userId: primaryResponsibleId,
    role: "employee",
  });

  const serialized = JSON.stringify(result);
  assert.notEqual(result.access, "full");
  assert.doesNotMatch(serialized, /FOREIGN-INV-VISIBLE-ONLY-TO-ITS-OWNER/);
  assert.doesNotMatch(serialized, /TOP-SECRET-ROOM|SECRET-BUILDING/);
});

test("open cabinet gives an employee full read projection without requiring ownership", async () => {
  const service = workspaceService(room("open"), [
    item({ responsibleUserId: OWNER_ID, responsibleName: "Owner Employee" }),
  ]);

  const result = await service.findById(ROOM_ID, OUTSIDER);

  assert.equal(result.access, "full");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.responsibleName, "Owner Employee");
});

test("admin and warehouse retain full access to a closed cabinet", async () => {
  const service = workspaceService(room("closed"), [item()]);

  for (const actor of [ADMIN, WAREHOUSE]) {
    const result = await service.findById(ROOM_ID, actor);
    assert.equal(result.access, "full");
    assert.equal(result.items.length, 1);
  }
});

function room(accessMode: "open" | "closed"): RoomWorkspaceRecord {
  return {
    id: ROOM_ID,
    designation: "TOP-SECRET-ROOM",
    buildingName: "SECRET-BUILDING",
    floorNumber: 7,
    floorLabel: "Restricted floor",
    primaryResponsibleId: "66666666-6666-4666-8666-666666666666",
    primaryResponsibleName: "Primary Responsible",
    // Deliberately model the new persisted field while keeping the attack test
    // executable against the pre-change repository contract.
    accessMode,
  } as RoomWorkspaceRecord;
}

function item(
  overrides: Partial<RoomWorkspaceItemRecord> & { responsibleUserId?: string } = {},
): RoomWorkspaceItemRecord {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    name: "Monitor",
    inventoryNumber: "INV-1",
    description: "Inventory description",
    status: "active",
    condition: "good",
    connectionStatus: "connected",
    responsibleName: "Owner Employee",
    hasPhoto: true,
    createdAt: new Date("2026-09-18T00:00:00.000Z"),
    responsibleUserId: OWNER_ID,
    ...overrides,
  } as RoomWorkspaceItemRecord;
}

function workspaceService(
  targetRoom: RoomWorkspaceRecord,
  items: RoomWorkspaceItemRecord[],
) {
  const repositories: RoomWorkspaceRepositories = {
    rooms: {
      findRoomById: async (id) => (id === ROOM_ID ? targetRoom : null),
      findRoomByQr: async (key) => (key === QR_KEY ? targetRoom : null),
      listRoomItems: async (id) => (id === ROOM_ID ? items : []),
    },
  };
  const unitOfWork: UnitOfWork<RoomWorkspaceRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new RoomWorkspaceService(unitOfWork);
}
