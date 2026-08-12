import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("keeps the settings switch thumb inside its track", () => {
  const source = ["../components/SettingsForm.tsx", "../components/Switch.tsx"]
    .map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8"))
    .join("\n");

  assert.match(source, /absolute left-0\.5 top-0\.5 h-5 w-5/);
  assert.match(source, /checked \? "translate-x-5" : "translate-x-0"/);
  assert.doesNotMatch(source, /translate-x-0\.5/);
});
