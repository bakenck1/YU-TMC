import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("inspections page includes maintenance inventory workflow", () => {
  const page = readFileSync("app/(protected)/inventory/inspections/page.tsx", "utf8");
  const panel = readFileSync("components/MaintenanceItemsPanel.tsx", "utf8");
  assert.match(page, /item\.status === \"maintenance\"/);
  assert.match(panel, /Вернуть в «Активен»/);
  assert.match(panel, /Списать/);
  assert.match(panel, /room\.buildingName/);
  assert.match(panel, /responsible\?\.name/);
  assert.match(panel, /updatedAt/);
  assert.match(panel, /status/);
});
