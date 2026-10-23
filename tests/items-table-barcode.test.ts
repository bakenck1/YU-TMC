import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("inventory list does not substitute a generated scan payload for the saved inventory number", () => {
  const source = readFileSync(new URL("../components/ItemsTable.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /code39PayloadForItem|needsUniqueItemBarcode/);
  assert.doesNotMatch(source, /item\.qrCode \?\? item\.inventoryNumber/);
});
