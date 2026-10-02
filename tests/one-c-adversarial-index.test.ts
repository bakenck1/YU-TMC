import assert from "node:assert/strict";
import test from "node:test";

import { createOneCIdentifierIndex, matchOneCFixedAssetIdentifiers, type OneCInventoryCandidate } from "../lib/one-c-reconciliation";

test("indexed identifiers agree with the original scan under deterministic adversarial aliases and collisions", () => {
  const values = ["", " ", "---", "A/B-01", "a/b-01", "AB01", "Ａ/Ｂ-０１", "Ж-001", "YUB-A/B-01",
    "*A/B-01*", "*YUB-A/B-01*", "YUI-AAAAAAAABBBB4CCC", "*YUI-AAAAAAAABBBB4CCC*", "№123", "0", "0001", "__proto__", "constructor", "a.b", "a\\b", "\u00a0A/B-01\u00a0", "ß", "SS"];
  let seed = 0x71cc9;
  const pick = <T>(entries: readonly T[]): T => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return entries[seed % entries.length];
  };
  for (let population = 0; population < 50; population++) {
    const items: OneCInventoryCandidate[] = Array.from({ length: 15 }, (_, index) => ({
      id: index % 3 ? `item-${index}` : `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, "0")}`,
      inventoryNumber: pick(values), oneCCode: pick(values),
      sourceCodes: [pick(values), pick(values), pick(values)],
      officialBarcodes: [pick(values), pick(values)],
    }));
    const index = createOneCIdentifierIndex(items);
    for (let attempt = 0; attempt < 400; attempt++) {
      const asset = { code: pick([...values, null]), inventoryNumber: pick([...values, null]), barcode: pick([...values, null]) };
      const linkedItemId = pick([null, "absent", ...items.map((item) => item.id)]);
      assert.deepEqual(matchOneCFixedAssetIdentifiers(asset, { items, linkedItemId, index }),
        matchOneCFixedAssetIdentifiers(asset, { items, linkedItemId }),
        `population=${population}; attempt=${attempt}; asset=${JSON.stringify(asset)}`);
    }
  }
});
