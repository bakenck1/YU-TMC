import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { USER_ROLES } from "../lib/contracts/users";
import { canAccessPath } from "../lib/security/authorization";

test("every user role can open an item card from the summary", () => {
  for (const role of USER_ROLES) {
    assert.equal(canAccessPath(role, "/items/item-1"), true, role);
  }

  const source = readFileSync(
    new URL("../components/InventorySummaryAccordions.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /onClick=\{\(\) => router\.push\(`\/items\/\$\{item\.id\}`\)\}/);
  assert.match(source, /cursor-pointer[^"]*hover:bg-zinc-50\/80/);
});

test("printed inventory labels contain only the generated code", () => {
  const source = readFileSync(
    new URL("../components/InventoryQrPrintView.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /print:border-0 print:p-0/);
  assert.match(source, /print:w-\[110mm\]/);
  assert.match(source, /min-w-0 flex-1 print:hidden/);
});
