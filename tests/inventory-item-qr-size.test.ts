import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shows the item QR code 20 percent larger", () => {
  const source = readFileSync(
    new URL("../components/InventoryItemDetails.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /width=\{86\.4\}/);
  assert.match(source, /height=\{86\.4\}/);
  assert.match(source, /className="h-\[86\.4px\] w-\[86\.4px\]"/);
});

test("shows the inventory number below the QR code only for general inventory", () => {
  const source = readFileSync(
    new URL("../components/InventoryItemDetails.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /\{item\.itemSection !== "it" \? <p className="mt-1 max-w-\[190px\] break-all font-mono text-sm font-medium text-zinc-700">\s*\{item\.inventoryNumber\}\s*<\/p> : null\}\s*<button/,
  );
});
