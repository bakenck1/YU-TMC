import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_INVENTORY_COLUMNS, parseInventoryColumnVisibility } from "../lib/inventory-columns";

test("saved column settings are validated and merged with new defaults", () => {
  assert.deepEqual(parseInventoryColumnVisibility("bad-json"), DEFAULT_INVENTORY_COLUMNS);
  assert.deepEqual(
    parseInventoryColumnVisibility(JSON.stringify({ photo: false, createdAt: true, price: "no" })),
    { ...DEFAULT_INVENTORY_COLUMNS, photo: false, createdAt: true },
  );
});
