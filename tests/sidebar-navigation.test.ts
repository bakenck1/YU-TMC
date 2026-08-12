import assert from "node:assert/strict";
import test from "node:test";

import { sidebarItemsForRole } from "../components/Sidebar";

test("employee sidebar exposes the dedicated receive/issue workspace instead of the legacy transfer screen", () => {
  const items = sidebarItemsForRole("employee");
  const hrefs = items.map((item) => item.href);

  assert.deepEqual(hrefs, ["/", "/items", "/scan", "/requests", "/tmc", "/profile"]);
  assert.equal(items.find((item) => item.href === "/tmc")?.labelKey, "tmc.entryPoint");
  assert.equal(items.some((item) => item.href === "/transfers"), false);
});

test("administrator sidebar keeps facilities and inspections", () => {
  const hrefs = sidebarItemsForRole("admin").map((item) => item.href);

  assert.ok(hrefs.includes("/inventory"));
  assert.ok(hrefs.includes("/inventory/inspections"));
  assert.ok(hrefs.includes("/requests"));
});

test("warehouse sidebar exposes analytics and decommissioned items", () => {
  const hrefs = sidebarItemsForRole("warehouse").map((item) => item.href);

  assert.deepEqual(hrefs, ["/", "/items", "/scan", "/requests", "/tmc", "/items/decommissioned", "/analytics", "/profile"]);
});
//

test("logout control calls the authenticated logout flow", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../components/SidebarContent.tsx", import.meta.url), "utf8"),
  );

  assert.match(source, /await logout\(\)/);
  assert.doesNotMatch(source, /href="\/login"[\s\S]*nav\.logout/);
});
