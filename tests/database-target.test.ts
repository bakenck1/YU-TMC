import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationDatabaseTarget,
  DatabaseConfigurationError,
} from "@/lib/db/env";

test("application database target defaults to NODE_ENV", () => {
  assert.equal(applicationDatabaseTarget({ NODE_ENV: "production" }), "production");
});

test("standalone local runtime can explicitly select the development database", () => {
  assert.equal(
    applicationDatabaseTarget({
      NODE_ENV: "production",
      DATABASE_TARGET: "development",
    }),
    "development",
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
