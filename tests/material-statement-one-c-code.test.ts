import assert from "node:assert/strict";
import test from "node:test";

import { supportsMaterialStatementOneCCode } from "../lib/inventory-categories";

test("1C code can be edited for every general inventory category", () => {
  assert.equal(supportsMaterialStatementOneCCode("electrical_equipment"), true);
  assert.equal(supportsMaterialStatementOneCCode("components"), true);
  assert.equal(supportsMaterialStatementOneCCode("electronics"), true);
  assert.equal(supportsMaterialStatementOneCCode("furniture"), true);
  assert.equal(supportsMaterialStatementOneCCode("household_inventory"), true);
  assert.equal(supportsMaterialStatementOneCCode("wifi_access_point"), false);
  assert.equal(supportsMaterialStatementOneCCode(null), false);
});
