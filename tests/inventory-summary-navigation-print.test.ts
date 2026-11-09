import assert from "node:assert/strict";
import test from "node:test";

import { USER_ROLES } from "../lib/contracts/users";
import { canAccessPath } from "../lib/security/authorization";

test("item detail access is restricted to inventory roles", () => {
  for (const role of USER_ROLES) {
    assert.equal(canAccessPath(role, "/items/item-1"), role !== "typography", role);
  }
});
