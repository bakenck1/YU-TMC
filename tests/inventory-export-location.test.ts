import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasPermission } from "../lib/security/permissions";

const itemsPage = readFileSync("app/(protected)/items/page.tsx", "utf8");
const exportButton = readFileSync("components/InventoryExportButton.tsx", "utf8");
const analyticsCharts = readFileSync("components/AnalyticsCharts.tsx", "utf8");
const analyticsTools = readFileSync("components/AnalyticsExcelTools.tsx", "utf8");
const excelRoute = readFileSync("app/api/inventory/excel/route.ts", "utf8");

test("admin and warehouse retain inventory export permission", () => {
  assert.equal(hasPermission("admin", "inventory.report.export"), true);
  assert.equal(hasPermission("warehouse", "inventory.report.export"), true);
  assert.equal(hasPermission("employee", "inventory.report.export"), false);
});

test("inventory export is adjacent to the add action and hidden from employees", () => {
  assert.match(itemsPage, /const canCreate = hasPermission\(user\.role, "inventory\.item\.create"\)/);
  assert.match(itemsPage, /const canExport = hasPermission\(user\.role, "inventory\.report\.export"\)/);
  assert.match(
    itemsPage,
    /\{canExport \? <InventoryExportButton dataset="items" \/> : null\}[\s\S]*\{canCreate \? \([\s\S]*<InventoryItemCreateForm/,
  );
  assert.doesNotMatch(itemsPage, /excelDataset=/);
});

test("inventory export reports progress and errors and downloads the workbook", () => {
  assert.match(exportButton, /disabled=\{busy\} aria-busy=\{busy\}/);
  assert.match(exportButton, /busy \? t\("excel\.exporting"\) : t\("excel\.exportItems"\)/);
  assert.match(exportButton, /if \(!response\.ok\) throw new Error\("export_failed"\)/);
  assert.match(exportButton, /<p role="alert"/);
  assert.match(exportButton, /URL\.createObjectURL\(await response\.blob\(\)\)/);
  assert.match(exportButton, /anchor\.download = dataset === "items" \? "inventory-items\.xlsx"/);
  assert.match(exportButton, /anchor\.click\(\)/);
});

test("analytics has no export controls or analytics export dataset", () => {
  assert.doesNotMatch(analyticsCharts, /exportReport|analytics\.exportReport|canExport/);
  assert.doesNotMatch(analyticsTools, /InventoryExportButton|canExport/);
  assert.doesNotMatch(excelRoute, /dataset === ["']analytics["']|exportAnalyticsReport/);
});
