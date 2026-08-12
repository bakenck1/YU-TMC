import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Children, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EmployeeItemsTabList,
} from "../components/EmployeeItemsTabs";
import { employeeItemTabAfterKey, employeeItemsForStatus } from "../lib/employee-items-tabs";

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

});

test("employee tab keyboard interaction invokes selection, focus, and preventDefault", () => {
  type ButtonProps = {
    onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
  };
  const selected: string[] = [];
  const focused: string[] = [];
  const list = EmployeeItemsTabList({
    activeStatus: "active",
    ariaLabel: "Inventory",
    label: (status) => status,
    onSelect: (status) => selected.push(status),
    focusTab: (status) => focused.push(status),
  }) as ReactElement<{ children?: ReactNode }>;
  const buttons = Children.toArray(list.props.children) as Array<ReactElement<ButtonProps>>;
  let prevented = false;

  buttons[0]?.props.onKeyDown?.({
    key: "ArrowLeft",
    preventDefault: () => {
      prevented = true;
    },
  });

  assert.deepEqual(selected, ["decommissioned"]);
  assert.deepEqual(focused, ["decommissioned"]);
  assert.equal(prevented, true);
  assert.equal(employeeItemTabAfterKey("maintenance", "Home"), "active");
  assert.equal(employeeItemTabAfterKey("active", "End"), "decommissioned");
});

test("employee status selection returns only the selected status items", () => {
  const items = [
    { id: "a", status: "active" },
    { id: "m", status: "maintenance" },
    { id: "d", status: "decommissioned" },
  ] as const;
  const renderedIds = employeeItemsForStatus(items, "maintenance").map((item) => item.id);
  assert.deepEqual(renderedIds, ["m"]);
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
