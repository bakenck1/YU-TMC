import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationError,
  isApplicationError,
} from "../lib/domain/application-error";
import { applicationErrorResponse } from "../lib/server/http/error-response";

test("recognizes an application error created by a separate server bundle", async () => {
  const bundledError = Object.assign(new Error("inventory_number_already_exists"), {
    name: "ApplicationError",
    kind: "conflict",
    publicCode: "inventory_number_already_exists",
    safeDetails: undefined,
  });

  assert.equal(isApplicationError(bundledError), true);
  assert.equal(bundledError instanceof ApplicationError, true);

  const response = applicationErrorResponse(bundledError);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "inventory_number_already_exists",
  });
});

test("does not expose an arbitrary error as a public application error", async () => {
  const invalidError = Object.assign(new Error("database password leaked"), {
    name: "ApplicationError",
    kind: "database",
    publicCode: "database password leaked",
  });

  assert.equal(isApplicationError(invalidError), false);
  assert.equal(invalidError instanceof ApplicationError, false);

  const response = applicationErrorResponse(invalidError);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
});
