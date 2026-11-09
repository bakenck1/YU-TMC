import assert from "node:assert/strict";
import test from "node:test";
import { canAccessPath } from "../lib/security/authorization";

test("TMC deep links allow receiving and issuing while administrative transfer stays restricted", () => {
  for (const role of ["employee", "warehouse", "admin"] as const) {
    for (const path of ["/tmc", "/tmc/receive", "/tmc/issue", "/tmc/history"]) {
      assert.equal(canAccessPath(role, path), true, `${role}: ${path}`);
    }
    assert.equal(canAccessPath(role, "/tmc/transfer"), role === "admin");
  }
  assert.equal(canAccessPath("typography", "/tmc"), false);
});
