import assert from "node:assert/strict";
import test from "node:test";

import { canAccessPath } from "../lib/security/authorization";
import { hasPermission } from "../lib/security/permissions";

test("warehouse is read-only and cannot access inspection workflows", () => {
  const warehouse = "warehouse" as const;

  assert.equal(hasPermission(warehouse, "inventory.item.read_all"), true);
  assert.equal(hasPermission(warehouse, "inventory.report.export"), true);
  assert.equal(hasPermission(warehouse, "inventory.item.create"), false);
  assert.equal(hasPermission(warehouse, "inventory.item.edit_content"), false);
  assert.equal(
    hasPermission(warehouse, "inventory.item.manage_protected_fields"),
    false,
  );
  assert.equal(hasPermission(warehouse, "inventory.item.send_to_service"), false);
  assert.equal(hasPermission(warehouse, "inventory.item.bulk_manage"), false);

  assert.equal(hasPermission(warehouse, "inventory.inspection.create_self"), false);
  assert.equal(hasPermission(warehouse, "inventory.inspection.read_own"), false);
  assert.equal(hasPermission(warehouse, "inventory.inspection.mutate_own_draft"), false);
  assert.equal(hasPermission(warehouse, "inventory.result.record_own_inspection"), false);
  assert.equal(canAccessPath(warehouse, "/inventory/inspections"), false);
});

