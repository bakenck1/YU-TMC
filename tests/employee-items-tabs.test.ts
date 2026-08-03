import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Children, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EmployeeItemsTabList,
  EmployeeItemsTabPanels,
  EmployeeItemsTabsView,
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
  assert.match(panels, /aria-labelledby="employee-items-tab-active"/);
  assert.match(panels, /aria-labelledby="employee-items-tab-maintenance"/);
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

test("employee view passes only the selected status items to its table", () => {
  const items = [
    { id: "a", status: "active" },
    { id: "m", status: "maintenance" },
    { id: "d", status: "decommissioned" },
  ] as never[];
  let renderedIds: string[] = [];
  renderToStaticMarkup(
    createElement(EmployeeItemsTabsView, {
      items,
      activeStatus: "maintenance",
      ariaLabel: "Inventory",
      label: (status) => status,
      onSelect: () => undefined,
      renderItems: (visibleItems) => {
        renderedIds = visibleItems.map((item) => item.id);
        return createElement("p", null, renderedIds.join(","));
      },
    }),
  );
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
