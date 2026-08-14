import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("inspection result route validates body item identifiers as UUIDs", () => {
  const route = readFileSync(
    "app/api/inventory/inspections/[id]/rooms/[roomId]/results/route.ts",
    "utf8",
  );

  assert.match(route, /!isUuid\(body\.itemId\)/);
});
