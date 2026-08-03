import assert from "node:assert/strict";
import test from "node:test";

import type {
  InventoryResponsibilityRepositories,
  InventoryResponsibilityRepository,
  TransferRecord,
} from "../lib/application/ports/inventory-responsibility-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { InventoryResponsibilityService } from "../lib/application/services/inventory-responsibility-service";
import { ApplicationError } from "../lib/domain/application-error";

const TRANSFER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";

function createService(transfer: TransferRecord) {
  const repositories = {
    responsibility: {
      findTransfer: async () => transfer,
    } as InventoryResponsibilityRepository,
  } satisfies InventoryResponsibilityRepositories;
  const unitOfWork: UnitOfWork<InventoryResponsibilityRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  return new InventoryResponsibilityService(
    unitOfWork,
    { now: () => new Date("2026-08-03T12:00:00.000Z") },
    { create: () => "44444444-4444-4444-8444-444444444444" },
  );
}

test("does not reveal the state of another owner's transfer", async () => {
  const service = createService({
    id: TRANSFER_ID,
    itemId: "55555555-5555-4555-8555-555555555555",
    requestedBy: OTHER_EMPLOYEE_ID,
    requestedByName: "Requester",
    proposedResponsibleId: OTHER_EMPLOYEE_ID,
    currentResponsibleIdAtRequest: OWNER_ID,
    currentResponsibleName: "Owner",
    status: "confirmed",
    requestedAt: new Date("2026-08-01T12:00:00.000Z"),
    closedAt: new Date("2026-08-02T12:00:00.000Z"),
    decisionComment: null,
    version: 2,
  });

  await assert.rejects(
    service.decideTransfer(
      TRANSFER_ID,
      { version: 2, decision: "confirm" },
      { userId: OTHER_EMPLOYEE_ID, role: "employee" },
    ),
    (error) =>
      error instanceof ApplicationError &&
      error.kind === "not_found" &&
      error.publicCode === "transfer_not_found",
  );
});
