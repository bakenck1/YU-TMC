import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryInspectionRepositories,
  InventoryInspectionRepository,
} from "../lib/application/ports/inventory-inspection-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryInspectionService } from "../lib/application/services/inventory-inspection-service";
import { ApplicationError } from "../lib/domain/application-error";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_TECHNICIAN_ID = "22222222-2222-4222-8222-222222222222";

test("recording an inspection result does not reveal a foreign inspection", async () => {
  const foreignInspection = {
    id: "foreign-inspection",
    name: "Foreign inspection",
    technicianId: FOREIGN_TECHNICIAN_ID,
    status: "draft" as const,
    version: 1,
    createdAt: new Date("2026-08-03T08:00:00.000Z"),
    updatedAt: new Date("2026-08-03T08:00:00.000Z"),
    deadlineAt: new Date("2026-09-03T08:00:00.000Z"),
  };
  const repository = {
    findInspection: async (id: string) =>
      id === foreignInspection.id ? foreignInspection : null,
    findInspectionForUpdate: async (id: string) =>
      id === foreignInspection.id ? foreignInspection : null,
  } as unknown as InventoryInspectionRepository;
  const repositories = {
    inspections: repository,
  } satisfies InventoryInspectionRepositories;
  const unitOfWork: UnitOfWork<InventoryInspectionRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new InventoryInspectionService(
    unitOfWork,
    { now: () => new Date("2026-08-03T08:00:00.000Z") },
    { create: () => "unused" },
  );
  const actor = { userId: ACTOR_ID, role: "warehouse" as const };
  const input = { itemId: "item-id", result: "present" as const };

  const missingError = await captureApplicationError(() =>
    service.recordItemResult("missing-inspection", "room-id", input, actor),
  );
  const foreignError = await captureApplicationError(() =>
    service.recordItemResult(foreignInspection.id, "room-id", input, actor),
  );

  assert.deepEqual(
    { kind: foreignError.kind, code: foreignError.publicCode },
    { kind: missingError.kind, code: missingError.publicCode },
  );
});

async function captureApplicationError(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof ApplicationError);
    return error;
  }
  assert.fail("Expected an ApplicationError");
}
