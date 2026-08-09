import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { translate } from "../lib/i18n";
import { canAccessPath } from "../lib/security/authorization";
import { TMC_ENTRY_POINT } from "../lib/tmc-navigation";

test("TMC entry point UI and protected route type-check together", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join("node_modules", "typescript", "bin", "tsc"),
      "--project",
      path.join("tests", "typecheck", "tsconfig.tmc-entry-point.json"),
      "--pretty",
      "false",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
});

test("TMC entry point has a dedicated route and localized label", () => {
  assert.deepEqual(TMC_ENTRY_POINT, {
    href: "/tmc",
    labelKey: "tmc.entryPoint",
  });
  assert.equal(translate("ru", TMC_ENTRY_POINT.labelKey), "Принять / Выдать ТМЦ");
  assert.equal(translate("kk", TMC_ENTRY_POINT.labelKey), "ТМҚ қабылдау / беру");
  assert.equal(translate("en", TMC_ENTRY_POINT.labelKey), "Receive / issue inventory");
  for (const role of ["employee", "warehouse", "admin"] as const) {
    assert.equal(canAccessPath(role, TMC_ENTRY_POINT.href), true);
  }
});

test("Dashboard renders exactly one dedicated TMC entry without changing global navigation", () => {
  const dashboard = readFileSync("components/Dashboard.tsx", "utf8");
  const sidebar = readFileSync("components/Sidebar.tsx", "utf8");
  const mobile = readFileSync("components/MobileBottomNavigation.tsx", "utf8");

  assert.match(dashboard, /href=\{TMC_ENTRY_POINT\.href\}/);
  assert.match(dashboard, /t\(TMC_ENTRY_POINT\.labelKey\)/);
  assert.equal(dashboard.match(/href=\{TMC_ENTRY_POINT\.href\}/g)?.length, 1);
  assert.doesNotMatch(dashboard, /href=["']\/transfers["']/);
  assert.doesNotMatch(sidebar, /["']\/tmc["']/);
  assert.doesNotMatch(mobile, /["']\/tmc["']/);
});

test("TMC entry route is protected and remains an operation-free landing shell", () => {
  const page = readFileSync("app/(protected)/tmc/page.tsx", "utf8");
  const landing = readFileSync("components/TmcLanding.tsx", "utf8");
  const header = readFileSync("components/Header.tsx", "utf8");

  assert.match(page, /requireAuthorizedPage\(TMC_ENTRY_POINT\.href\)/);
  assert.match(page, /<TmcLanding/);
  assert.match(landing, /t\(TMC_ENTRY_POINT\.labelKey\)/);
  assert.match(header, /"\/tmc": "tmc\.entryPoint"/);
  assert.doesNotMatch(landing, /Принять ТМЦ|Выдать ТМЦ|Перемещение ТМЦ|QR|scanner/i);
  assert.doesNotMatch(landing, /<button/);
});
