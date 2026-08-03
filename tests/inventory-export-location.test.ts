import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasPermission } from "../lib/security/permissions";

const itemsTable = readFileSync("components/ItemsTable.tsx", "utf8");
const analyticsCharts = readFileSync("components/AnalyticsCharts.tsx", "utf8");
const analyticsTools = readFileSync("components/AnalyticsExcelTools.tsx", "utf8");
const excelRoute = readFileSync("app/api/inventory/excel/route.ts", "utf8");

test("admin and warehouse retain inventory export permission", () => {
  assert.equal(hasPermission("admin", "inventory.report.export"), true);
  assert.equal(hasPermission("warehouse", "inventory.report.export"), true);
  assert.equal(hasPermission("employee", "inventory.report.export"), false);
});

test("inventory export is rendered from the inventory list", () => {
  assert.match(itemsTable, /InventoryExportButton/);
  assert.match(itemsTable, /excelDataset/);
});

test("analytics has no export controls or analytics export dataset", () => {
  assert.doesNotMatch(analyticsCharts, /exportReport|analytics\.exportReport|canExport/);
  assert.doesNotMatch(analyticsTools, /InventoryExportButton|canExport/);
  assert.doesNotMatch(excelRoute, /dataset === ["']analytics["']|exportAnalyticsReport/);
});
