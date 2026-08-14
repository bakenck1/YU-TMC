import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { translate } from "../lib/i18n";
import { canAccessPath } from "../lib/security/authorization";
import {
  TMC_ENTRY_POINT,
  TMC_OPERATIONS,
} from "../lib/tmc-navigation";

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

test("global navigation exposes the TMC entry without duplicating it on Dashboard", () => {
  const dashboard = readFileSync("components/Dashboard.tsx", "utf8");
  const sidebar = readFileSync("components/SidebarContent.tsx", "utf8");
  const mobile = readFileSync("components/MobileBottomNavigation.tsx", "utf8");

  assert.doesNotMatch(dashboard, /TMC_ENTRY_POINT/);
  assert.doesNotMatch(dashboard, /href=\{TMC_ENTRY_POINT\.href\}/);
  assert.doesNotMatch(dashboard, /href=["']\/transfers["']/);
  assert.match(sidebar, /href: "\/tmc", labelKey: "tmc\.entryPoint"/);
  assert.doesNotMatch(mobile, /["']\/tmc["']/);
  assert.doesNotMatch(sidebar, /href: "\/transfers", labelKey: "nav\.scanItem"/);
});

test("TMC entry route loads participant-scoped requests and the user's own items", () => {
  const page = readFileSync("app/(protected)/tmc/page.tsx", "utf8");
  const landing = readFileSync("components/TmcLanding.tsx", "utf8");
  const header = readFileSync("components/Header.tsx", "utf8");

  assert.match(page, /requireAuthorizedPage\(TMC_ENTRY_POINT\.href\)/);
  assert.match(page, /listHistory\(/);
  assert.match(page, /recipientId: user\.userId/);
  assert.match(page, /responsibleId === user\.userId/);
  assert.match(page, /<TmcLanding[\s\S]*incomingRequests=/);
  assert.match(landing, /t\(TMC_ENTRY_POINT\.labelKey\)/);
  assert.match(header, /"\/tmc": "tmc\.entryPoint"/);
  assert.match(header, /<TmcNotifications/);
});

test("TMC history page forwards the session proof to the history service", () => {
  const page = readFileSync("app/(protected)/tmc/history/page.tsx", "utf8");
  assert.match(page, /listHistory\(filters,\s*\{[\s\S]*userId: user\.userId[\s\S]*role: user\.role[\s\S]*sessionVersion: user\.sessionVersion/);
});

test("TMC landing exposes exactly the three specified operations", () => {
  assert.deepEqual(TMC_OPERATIONS, [
    { id: "receive", href: "/tmc/receive", labelKey: "tmc.operation.receive" },
    { id: "issue", href: "/tmc/issue", labelKey: "tmc.operation.issue" },
    { id: "transfer", href: "/tmc/transfer", labelKey: "tmc.operation.transfer" },
  ]);
  assert.equal(new Set(TMC_OPERATIONS.map(({ href }) => href)).size, 3);
  assert.equal(
    TMC_OPERATIONS.map(({ href }) => href as string).includes("/transfers"),
    false,
  );
  assert.equal(TMC_OPERATIONS.some(({ href }) => /[?#]/.test(href)), false);

  const expected = {
    receive: ["Принять", "Қабылдау", "Receive"],
    issue: ["Выдать", "Беру", "Issue"],
    transfer: ["Перемещение ТМЦ", "ТМҚ жауапкершілігін беру", "Transfer responsibility"],
  } as const;
  for (const operation of TMC_OPERATIONS) {
    const labels = (["ru", "kk", "en"] as const).map((language) =>
      translate(language, operation.labelKey),
    );
    assert.deepEqual(labels, expected[operation.id]);
    assert.doesNotMatch(labels[2], /[А-Яа-яЁё]/u);
    for (const role of ["employee", "warehouse", "admin"] as const) {
      assert.equal(
        canAccessPath(role, operation.href),
        operation.id === "transfer" ? role === "admin" : true,
      );
    }
  }
});

test("TMC operation routes remain available as protected deep links", () => {
  const landing = readFileSync("components/TmcLanding.tsx", "utf8");
  const shell = readFileSync("components/TmcOperationShell.tsx", "utf8");
  const header = readFileSync("components/Header.tsx", "utf8");

  assert.match(landing, /role="tablist"/);
  assert.match(landing, /TmcOperationShell/);
  assert.match(shell, /<TmcItemQrFlow[\s\S]*operation=\{operation\}/);
  assert.doesNotMatch(shell, /<form|fetch\(|picker/i);

  for (const operation of TMC_OPERATIONS) {
    const page = readFileSync(
      `app/(protected)/tmc/${operation.id}/page.tsx`,
      "utf8",
    );
    assert.match(page, /requireAuthorizedPage\(operation\.href\)/);
    assert.match(page, /<TmcOperationShell operation=\{operation\}/);
    assert.match(
      header,
      new RegExp(`"${operation.href}": "${operation.labelKey.replaceAll(".", "\\.")}"`),
    );
    assert.doesNotMatch(page, /<button|<form|fetch\(|QR|scanner|picker/i);
  }
});
