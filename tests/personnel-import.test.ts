import assert from "node:assert/strict";
import test from "node:test";

import { buildPersonnelImportPlan } from "../lib/personnel-import";

test("personnel import keeps eligible staff and assigns only unambiguous IIN values", () => {
  const plan = buildPersonnelImportPlan([
    row({ email: " First@YU.EDU.KZ ", identify_code: "123456789012" }),
    row({ email: "second@yu.edu.kz", identify_code: "999999999999" }),
    row({ email: "third@yu.edu.kz", identify_code: "999999999999" }),
    row({ email: "duplicate@yu.edu.kz", identify_code: "111111111111" }),
    row({ email: "duplicate@yu.edu.kz", identify_code: "222222222222" }),
    row({ email: "inactive@yu.edu.kz", is_active: "0" }),
    row({ email: "aborted@yu.edu.kz", sync_status: "sync_abort" }),
    row({ email: "", gsuite_email: "fallback@yu.edu.kz", identify_code: "bad" }),
    row({ email: "outside@example.com" }),
  ]);

  assert.deepEqual(plan.candidates, [
    { email: "first@yu.edu.kz", fullName: "Surname Name Middle", iin: "123456789012" },
    { email: "second@yu.edu.kz", fullName: "Surname Name Middle", iin: null },
    { email: "third@yu.edu.kz", fullName: "Surname Name Middle", iin: null },
    { email: "fallback@yu.edu.kz", fullName: "Surname Name Middle", iin: null },
  ]);
  assert.equal(plan.summary.eligible, 4);
  assert.equal(plan.summary.duplicateEmailRows, 2);
  assert.equal(plan.summary.duplicateIinRows, 2);
  assert.equal(plan.summary.withUniqueIin, 1);
  assert.equal(plan.summary.inactive, 1);
  assert.equal(plan.summary.rejectedBySource, 1);
  assert.equal(plan.summary.invalidEmail, 1);
});

test("personnel import rejects non-array and oversized sources", () => {
  assert.throws(() => buildPersonnelImportPlan({}), /array/);
  assert.throws(() => buildPersonnelImportPlan(new Array(50_001)), /50000/);
});

function row(overrides: Record<string, string>) {
  return {
    email: "employee@yu.edu.kz",
    gsuite_email: "",
    last_name: "Surname",
    first_name: "Name",
    middle_name: "Middle",
    identify_code: "",
    is_active: "1",
    sync_status: "sync_success",
    ...overrides,
  };
}
