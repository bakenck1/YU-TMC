import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationDatabaseTarget,
  DatabaseConfigurationError,
} from "@/lib/db/env";

test("application database target defaults to NODE_ENV", () => {
  assert.equal(applicationDatabaseTarget({ NODE_ENV: "production" }), "production");
});

test("production cannot downgrade its database target", () => {
  assert.throws(
    () => applicationDatabaseTarget({ NODE_ENV: "production", DATABASE_TARGET: "development" }),
    DatabaseConfigurationError,
  );
});

test("browser smoke has an explicit isolated test exception", () => {
  assert.equal(
    applicationDatabaseTarget({
      NODE_ENV: "production",
      NEXT_DIST_DIR: ".next-e2e",
      YU_INVENTORY_E2E_DATABASE_TARGET: "test",
      DATABASE_TARGET: "test",
    }),
    "test",
  );
});

test("application database target rejects invalid explicit values", () => {
  assert.throws(
    () =>
      applicationDatabaseTarget({
        NODE_ENV: "production",
        DATABASE_TARGET: "staging",
      }),
    DatabaseConfigurationError,
  );
});
