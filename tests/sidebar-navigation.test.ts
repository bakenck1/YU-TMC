import assert from "node:assert/strict";
import test from "node:test";

import { sidebarItemsForRole } from "../components/Sidebar";

test("employee sidebar exposes home, inventory, room QR scan, transfer workflow, and profile", () => {
  const hrefs = sidebarItemsForRole("employee").map((item) => item.href);

  assert.deepEqual(hrefs, ["/", "/items", "/scan", "/transfers", "/profile"]);
});

test("administrator sidebar keeps facilities and inspections", () => {
  const hrefs = sidebarItemsForRole("admin").map((item) => item.href);

  assert.ok(hrefs.includes("/inventory"));
  assert.ok(hrefs.includes("/inventory/inspections"));
});

test("warehouse sidebar exposes analytics and decommissioned items", () => {
  const hrefs = sidebarItemsForRole("warehouse").map((item) => item.href);

  assert.deepEqual(hrefs, ["/", "/items", "/scan", "/items/decommissioned", "/analytics", "/profile"]);
});
//
test("logout control calls the authenticated logout flow", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../components/Sidebar.tsx", import.meta.url), "utf8"),
  );

  assert.match(source, /await logout\(\)/);
  assert.doesNotMatch(source, /href="\/login"[\s\S]*nav\.logout/);
});
