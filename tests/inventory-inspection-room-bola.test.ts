import assert from "node:assert/strict";
import test from "node:test";

import type {
  InspectionRecord,
  InventoryInspectionRepositories,
  InventoryInspectionRepository,
} from "../lib/application/ports/inventory-inspection-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryInspectionService } from "../lib/application/services/inventory-inspection-service";
import { ApplicationError } from "../lib/domain/application-error";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_TECHNICIAN_ID = "22222222-2222-4222-8222-222222222222";
const FOREIGN_INSPECTION_ID = "33333333-3333-4333-8333-333333333333";
const OWN_INSPECTION_ID = "44444444-4444-4444-8444-444444444444";
const MISSING_INSPECTION_ID = "55555555-5555-4555-8555-555555555555";
const BUILDING_ID = "66666666-6666-4666-8666-666666666666";
const ROOM_ID = "77777777-7777-4777-8777-777777777777";

test("adding a room does not reveal a foreign inspection", async () => {
  const service = createService({
    findInspection: async (id) =>
      id === FOREIGN_INSPECTION_ID
        ? inspection(FOREIGN_INSPECTION_ID, FOREIGN_TECHNICIAN_ID)
        : null,
  });
  const actor = { userId: ACTOR_ID, role: "warehouse" as const };
  const input = { buildingId: BUILDING_ID, roomId: ROOM_ID };

  const missingError = await captureApplicationError(() =>
    service.addRoom(MISSING_INSPECTION_ID, input, actor),
  );
  const foreignError = await captureApplicationError(() =>
    service.addRoom(FOREIGN_INSPECTION_ID, input, actor),
  );

  assert.deepEqual(
    { kind: foreignError.kind, code: foreignError.publicCode },
    { kind: missingError.kind, code: missingError.publicCode },
  );
});

test("adding a room rejects malformed room UUIDs before persistence", async () => {
  let roomLookupCount = 0;
  const service = createService({
    findInspection: async (id) =>
      id === OWN_INSPECTION_ID ? inspection(OWN_INSPECTION_ID, ACTOR_ID) : null,
    findActiveRoomSnapshot: async () => {
      roomLookupCount += 1;
      throw new Error("invalid input syntax for type uuid");
    },
  });

  const error = await captureApplicationError(() =>
    service.addRoom(
      OWN_INSPECTION_ID,
      { buildingId: "not-a-uuid", roomId: ROOM_ID },
      { userId: ACTOR_ID, role: "warehouse" },
    ),
  );

  assert.equal(error.kind, "forbidden");
  assert.equal(error.publicCode, "forbidden");
  assert.equal(roomLookupCount, 0);
});

function createService(
  repositoryOverrides: Partial<InventoryInspectionRepository>,
) {
  const repository = {
    ...repositoryOverrides,
    findInspectionForUpdate:
      repositoryOverrides.findInspectionForUpdate ??
      repositoryOverrides.findInspection,
  } as InventoryInspectionRepository;
  const repositories = {
    inspections: repository,
  } satisfies InventoryInspectionRepositories;
  const unitOfWork: UnitOfWork<InventoryInspectionRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryInspectionService(
    unitOfWork,
    { now: () => new Date("2026-08-03T08:00:00.000Z") },
    { create: () => "88888888-8888-4888-8888-888888888888" },
  );
}

function inspection(id: string, technicianId: string): InspectionRecord {
  return {
    id,
    name: "Inspection",
    technicianId,
    status: "draft",
    version: 1,
    createdAt: new Date("2026-08-03T08:00:00.000Z"),
    updatedAt: new Date("2026-08-03T08:00:00.000Z"),
    deadlineAt: new Date("2026-09-03T08:00:00.000Z"),
  };
}

async function captureApplicationError(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof ApplicationError);
    return error;
  }
  assert.fail("Expected an ApplicationError");
}
