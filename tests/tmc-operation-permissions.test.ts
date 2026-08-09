import assert from "node:assert/strict";
import test from "node:test";

import {
  canPerformInventoryOperation,
  hasPermission,
} from "../lib/security/permissions";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_OWNER_ID = "22222222-2222-4222-8222-222222222222";

test("grouped TMC transfer permission is separate and resource-bound", () => {
  assert.equal(
    hasPermission("employee", "inventory.tmc.transfer_request.create"),
    true,
  );
  assert.equal(
    hasPermission("admin", "inventory.tmc.transfer_request.create"),
    true,
  );
  assert.equal(
    hasPermission("warehouse", "inventory.tmc.transfer_request.create"),
    true,
  );

  assert.equal(canCreate("employee", OWNER_ID), true);
  assert.equal(canCreate("employee", FOREIGN_OWNER_ID), false);
  assert.equal(canCreate("admin", FOREIGN_OWNER_ID), true);
  assert.equal(canCreate("warehouse", OWNER_ID), true);
  assert.equal(canCreate("warehouse", FOREIGN_OWNER_ID), false);
  assert.equal(canCreate("unexpected-role", OWNER_ID), false);
});

function canCreate(role: string, currentResponsibleId: string) {
  return canPerformInventoryOperation(
    { userId: OWNER_ID, role } as never,
    {
      operation: "tmc.transfer_request.create",
      currentResponsibleId,
    },
  );
}
