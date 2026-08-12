import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("uses the YU Inventory logo in the authentication header", () => {
  const source = readFileSync(
    new URL("../components/AuthPageFrame.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /import Image from "next\/image"/);
  assert.match(source, /src="\/logo\.png"/);
  assert.match(source, /alt="YU Inventory"/);
  assert.doesNotMatch(source, />\s*YU\s*</);
});


