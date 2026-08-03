import assert from "node:assert/strict";
import test from "node:test";

import { sidebarItemsForRole } from "../components/Sidebar";

test("employee sidebar excludes objects and inspection requests", () => {
  const hrefs = sidebarItemsForRole("employee").map((item) => item.href);

  assert.ok(hrefs.includes("/items"));
  for (const hiddenPath of ["/inventory", "/inventory/inspections"]) {
    assert.ok(!hrefs.includes(hiddenPath), `unexpected employee nav item: ${hiddenPath}`);
  }
});

test("administrator sidebar keeps facilities and inspections", () => {
  const hrefs = sidebarItemsForRole("admin").map((item) => item.href);

  assert.ok(hrefs.includes("/inventory"));
  assert.ok(hrefs.includes("/inventory/inspections"));
});
