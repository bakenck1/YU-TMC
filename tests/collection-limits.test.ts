import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCollectionSize,
  sqlCollectionLimit,
} from "../lib/server/persistence/collection-limits";

test("collection SQL limits request one sentinel row beyond the budget", () => {
  assert.equal(sqlCollectionLimit(10), "limit 11");
});

test("collection budgets fail closed instead of silently truncating data", () => {
  assert.deepEqual(assertCollectionSize([1, 2], 2), [1, 2]);
  assert.throws(
    () => assertCollectionSize([1, 2, 3], 2),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ApplicationError" &&
      "kind" in error &&
      error.kind === "payload_too_large" &&
      "publicCode" in error &&
      error.publicCode === "collection_too_large",
  );
});
