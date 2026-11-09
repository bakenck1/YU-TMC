import assert from "node:assert/strict";
import test from "node:test";

import { createOneCIdentifierIndex, matchOneCFixedAssetIdentifiers, type OneCInventoryCandidate } from "../lib/one-c-reconciliation";

test("indexed and scan matching return independently specified results for aliases and conflicting identities", () => {
  const items: OneCInventoryCandidate[] = [
    { id: "a", inventoryNumber: "INV/001", oneCCode: "00042", officialBarcodes: ["INV/001"] },
    { id: "b", inventoryNumber: "INV/002", oneCCode: "__proto__", officialBarcodes: ["INV/002"] },
  ];
  const index = createOneCIdentifierIndex(items);
  const cases = [
    { asset: { inventoryNumber: "ＩＮＶ／００１", code: null, barcode: null }, id: "a" },
    { asset: { inventoryNumber: null, code: "00042", barcode: null }, id: "a" },
    { asset: { inventoryNumber: null, code: "__proto__", barcode: null }, id: "b" },
    { asset: { inventoryNumber: "INV/003", code: null, barcode: null }, id: null },
    { asset: { inventoryNumber: null, code: null, barcode: "*INV/002*" }, id: "b" },
    { asset: { inventoryNumber: "INV/001", code: "__proto__", barcode: null }, id: null },
  ];
  for (const { asset, id } of cases) {
    assert.equal(matchOneCFixedAssetIdentifiers(asset, { items, index }).itemId, id);
    assert.equal(matchOneCFixedAssetIdentifiers(asset, { items }).itemId, id);
  }
});
