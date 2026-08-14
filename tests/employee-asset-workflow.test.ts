import assert from "node:assert/strict";
import test from "node:test";

import { employeeScanAction } from "../lib/employee-asset-workflow";

test("a free active QR item offers receiving it for the current employee", () => {
  assert.deepEqual(
    employeeScanAction({
      status: "active",
      isAssigned: false,
      responsibleName: null,
      isCurrentUserResponsible: false,
    }),
    { kind: "claim_free" },
  );
});

test("an item assigned to another employee cannot be claimed and offers a transfer request", () => {
  assert.deepEqual(
    employeeScanAction({
      status: "active",
      isAssigned: true,
      responsibleName: "another employee",
      isCurrentUserResponsible: false,
    }),
    { kind: "request_transfer" },
  );
});

test("an employee's own QR item is shown as already assigned to them", () => {
  assert.deepEqual(
    employeeScanAction({
      status: "active",
      isAssigned: true,
      responsibleName: "current employee",
      isCurrentUserResponsible: true,
    }),
    { kind: "already_owned" },
  );
});

test("inactive QR items cannot be received or requested", () => {
  assert.deepEqual(
    employeeScanAction({
      status: "maintenance",
      isAssigned: false,
      responsibleName: null,
      isCurrentUserResponsible: false,
    }),
    { kind: "unavailable" },
  );
});
