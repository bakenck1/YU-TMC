import assert from "node:assert/strict";
import test from "node:test";

import type {
  InspectionRecord,
  InspectionRoomRecord,
  InventoryInspectionRepositories,
  InventoryInspectionRepository,
  ItemResultRecord,
} from "../lib/application/ports/inventory-inspection-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryInspectionService } from "../lib/application/services/inventory-inspection-service";

const NOW = new Date("2026-07-31T08:00:00.000Z");
const BUILDING_ID = "building-1";
const ROOM_ID = "room-1";
const ITEM_ID = "item-1";
const TECHNICIAN_ID = "11111111-1111-4111-8111-111111111111";

test("administrator can create, populate and record an inspection", async () => {
  const inspections = new Map<string, InspectionRecord>();
  const rooms = new Map<string, InspectionRoomRecord>();
  const results = new Map<string, ItemResultRecord>();
  const repository: InventoryInspectionRepository = {
    listInspections: async () => [...inspections.values()],
    findInspection: async (id) => inspections.get(id) ?? null,
    findAssignableTechnician: async (id) =>
      id === TECHNICIAN_ID ? { id, role: "employee" } : null,
    listRooms: async (inspectionId) =>
      [...rooms.values()].filter((room) => room.inspectionId === inspectionId),
    findInspectionRoom: async (inspectionId, roomId) => {
      const room = rooms.get(roomId);
      return room?.inspectionId === inspectionId ? room : null;
    },
    findItemSnapshot: async (itemId) =>
      itemId === ITEM_ID
        ? {
            itemId,
            registryRoomId: ROOM_ID,
            responsibleUserId: null,
            itemName: "Projector",
            inventoryNumberKind: "official",
            inventoryNumber: "INV-1",
            buildingName: "Main",
            roomDesignation: "101",
          }
        : null,
    findItemResult: async (inspectionId, itemId) =>
      [...results.values()].find(
        (result) =>
          result.inspectionId === inspectionId && result.itemId === itemId,
      ) ?? null,
    listItemResults: async (inspectionId) =>
      [...results.values()].filter(
        (result) => result.inspectionId === inspectionId,
      ),
    findActiveRoomSnapshot: async (buildingId, roomId) =>
      buildingId === BUILDING_ID && roomId === ROOM_ID
        ? {
            buildingId,
            roomId,
            buildingName: "Main",
            buildingAddress: "32 microdistrict",
            roomDesignation: "101",
            floorNumber: 1,
            floorLabel: null,
          }
        : null,
    insertInspection: async (input) => {
      const value: InspectionRecord = {
        id: input.id,
        name: input.name,
        technicianId: input.technicianId,
        status: "draft",
        version: 1,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      inspections.set(value.id, value);
      return value;
    },
    insertInspectionRoom: async (input) => {
      const value: InspectionRoomRecord = {
        id: input.id,
        inspectionId: input.inspectionId,
        ...input.snapshot,
        addedAt: input.addedAt,
        inspectedAt: null,
      };
      rooms.set(value.id, value);
      return value;
    },
    insertItemResult: async (input) => {
      const value: ItemResultRecord = {
        id: input.id,
        inspectionId: input.inspectionId,
        inspectionRoomId: input.inspectionRoomId,
        itemId: input.snapshot.itemId,
        registryRoomIdAtScan: input.snapshot.registryRoomId,
        responsibleIdAtScan: input.snapshot.responsibleUserId,
        itemNameSnapshot: input.snapshot.itemName,
        inventoryNumberSnapshot: input.snapshot.inventoryNumber,
        result: "undetermined",
        comment: null,
        revisionNumber: 0,
        createdAt: input.createdAt,
      };
      results.set(value.id, value);
      return value;
    },
    insertItemResultRevision: async (input) => {
      const current = results.get(input.resultId);
      if (!current) throw new Error("result_not_found");
      results.set(input.resultId, {
        ...current,
        result: input.result,
        comment: input.comment,
        revisionNumber: current.revisionNumber + 1,
      });
    },
    markInspectionRoomInspected: async () => undefined,
    appendAudit: async () => undefined,
  };
  const repositories = {
    inspections: repository,
  } satisfies InventoryInspectionRepositories;
  const unitOfWork: UnitOfWork<InventoryInspectionRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  let sequence = 0;
  const service = new InventoryInspectionService(
    unitOfWork,
    { now: () => NOW },
    { create: () => `id-${++sequence}` },
  );
  const actor = { userId: "admin-1", role: "admin" as const };

  const inspection = await service.create(
    { name: "Admin check", technicianId: TECHNICIAN_ID },
    actor,
  );
  const room = await service.addRoom(
    inspection.id,
    { buildingId: BUILDING_ID, roomId: ROOM_ID },
    actor,
  );
  const result = await service.recordItemResult(
    inspection.id,
    room.id,
    { itemId: ITEM_ID, result: "present" },
    actor,
  );

  assert.equal(inspection.technicianId, TECHNICIAN_ID);
  assert.equal(room.roomId, ROOM_ID);
  assert.equal(result.result, "present");
});
