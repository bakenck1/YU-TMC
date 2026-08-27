import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("inventory list displays the same Code 39 payload as the printable barcode", () => {
  const source = readFileSync(
    new URL("../components/ItemsTable.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /code39PayloadForItem\(item\.inventoryNumber, item\.id\)/);
  assert.doesNotMatch(source, /item\.qrCode \?\? item\.inventoryNumber/);
  assert.doesNotMatch(source, /replace\(\/\\D\/g/);
});
