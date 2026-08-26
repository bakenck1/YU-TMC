import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("inspections page includes the maintenance inventory workflow", () => {
  const page = readFileSync("app/(protected)/inventory/inspections/page.tsx", "utf8");
  const panel = readFileSync("components/MaintenanceItemsPanel.tsx", "utf8");
  const resolutionClient = readFileSync("lib/maintenance-resolution-client.ts", "utf8");
  assert.match(page, /item\.status === "maintenance"/);
  assert.match(panel, /maintenance\.returnActive/);
  assert.match(panel, /maintenance\.writeOff/);
  assert.match(panel, /maintenance\.tableCaption/);
  assert.match(panel, /room\.buildingName/);
  assert.match(panel, /responsible\?\.name/);
  assert.match(panel, /maintenanceStartedAt/);
  assert.match(resolutionClient, /operation: "resolve_maintenance"/);
  assert.match(resolutionClient, /error === "version_conflict"/);
});
