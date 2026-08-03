import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EmployeeItemsTabList,
  EmployeeItemsTabPanels,
} from "../components/EmployeeItemsTabs";
import { employeeItemTabAfterKey } from "../lib/employee-items-tabs";

test("employee inventory renders a roving, fully associated tab list", () => {
  const markup = renderToStaticMarkup(
    createElement(EmployeeItemsTabList, {
      activeStatus: "maintenance",
      ariaLabel: "Inventory",
      label: (status) => status,
      onSelect: () => undefined,
    }),
  );

  assert.match(markup, /role="tablist" aria-label="Inventory"/);
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((markup.match(/tabindex="0"/g) ?? []).length, 1);
  assert.equal((markup.match(/tabindex="-1"/g) ?? []).length, 2);
  assert.match(markup, /id="employee-items-tab-maintenance"[^>]*aria-selected="true"/);
  for (const status of ["active", "maintenance", "decommissioned"]) {
    assert.match(markup, new RegExp(`aria-controls="employee-items-panel-${status}"`));
  }

  const panels = renderToStaticMarkup(
    createElement(EmployeeItemsTabPanels, {
      activeStatus: "maintenance",
      renderActive: () => createElement("p", null, "visible items"),
    }),
  );
  assert.equal((panels.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.equal((panels.match(/ hidden=""/g) ?? []).length, 2);
  assert.match(panels, /id="employee-items-panel-maintenance"[^>]*><p>visible items<\/p>/);
});

test("employee tab keyboard interaction wraps and supports Home and End", () => {
  assert.equal(employeeItemTabAfterKey("active", "ArrowRight"), "maintenance");
  assert.equal(employeeItemTabAfterKey("maintenance", "ArrowRight"), "decommissioned");
  assert.equal(employeeItemTabAfterKey("decommissioned", "ArrowRight"), "active");
  assert.equal(employeeItemTabAfterKey("active", "ArrowLeft"), "decommissioned");
  assert.equal(employeeItemTabAfterKey("maintenance", "Home"), "active");
  assert.equal(employeeItemTabAfterKey("active", "End"), "decommissioned");
  assert.equal(employeeItemTabAfterKey("active", "Enter"), null);
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
