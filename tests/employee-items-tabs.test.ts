import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("employee inventory presents isolated status tabs", async () => {
  const source = await readFile(
    new URL("../components/EmployeeItemsTabs.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /role="tablist"/);
  assert.match(source, /useState<ItemStatus>\("active"\)/);
  assert.match(source, /status: "active"/);
  assert.match(source, /status: "maintenance"/);
  assert.match(source, /status: "decommissioned"/);
  assert.match(source, /items\.filter\(\(item\) => item\.status === activeStatus\)/);
  assert.match(source, /aria-selected=\{selected\}/);
  assert.match(source, /aria-controls=\{`employee-items-panel-\$\{tab\.status\}`\}/);
  assert.match(source, /aria-labelledby=\{`employee-items-tab-\$\{activeStatus\}`\}/);
  assert.match(source, /<ItemsTable[\s\S]*items=\{visibleItems\}/);
});

test("only employees receive the tabbed inventory interface", async () => {
  const source = await readFile(
    new URL("../app/(protected)/items/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /user\.role === "employee"/);
  assert.match(source, /<EmployeeItemsTabs/);
  assert.match(source, /<EmployeeItemsTabs[\s\S]*items=\{items\}/);
  assert.doesNotMatch(source, /items\/active|items\/maintenance|items\/decommissioned/);
});
