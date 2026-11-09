import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_INVENTORY_COLUMNS } from "../lib/inventory-columns";
import { createInventoryExportPayload } from "../lib/inventory-export";

test("IT inventory export never requests a barcode column", () => {
  const payload = createInventoryExportPayload(
    "it-items",
    ["11111111-1111-4111-8111-111111111111"],
    { ...DEFAULT_INVENTORY_COLUMNS, qrCode: true },
  );
  assert.equal(payload.columns.includes("qrCode"), false);
  assert.equal(payload.columns.includes("oneCCode"), false);
});
