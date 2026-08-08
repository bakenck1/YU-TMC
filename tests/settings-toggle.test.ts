import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("keeps the settings switch thumb inside its track", () => {
  const source = readFileSync(
    new URL("../components/SettingsForm.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /absolute left-0\.5 top-0\.5 h-5 w-5/);
  assert.match(source, /checked \? "translate-x-5" : "translate-x-0"/);
  assert.doesNotMatch(source, /translate-x-0\.5/);
});
