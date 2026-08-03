import assert from "node:assert/strict";
import test from "node:test";

import { sidebarItemsForRole } from "../components/Sidebar";

test("employee sidebar excludes facilities and inspections", () => {
  const hrefs = sidebarItemsForRole("employee").map((item) => item.href);

  assert.ok(hrefs.includes("/items"));
  assert.ok(!hrefs.includes("/inventory"));
  assert.ok(!hrefs.includes("/inventory/inspections"));
});

test("administrator sidebar keeps facilities and inspections", () => {
  const hrefs = sidebarItemsForRole("admin").map((item) => item.href);

  assert.ok(hrefs.includes("/inventory"));
  assert.ok(hrefs.includes("/inventory/inspections"));
});
