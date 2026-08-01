import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_INVENTORY_COLUMNS,
  INVENTORY_COLUMN_KEYS,
  parseInventoryColumnVisibility,
} from "../lib/inventory-columns";

test("inventory columns use the PRD defaults", () => {
  assert.equal(INVENTORY_COLUMN_KEYS.length, 12);
  assert.equal(DEFAULT_INVENTORY_COLUMNS.additionalInfo, false);
  assert.equal(DEFAULT_INVENTORY_COLUMNS.createdAt, false);
  for (const key of INVENTORY_COLUMN_KEYS) {
    if (key !== "additionalInfo" && key !== "createdAt") {
      assert.equal(DEFAULT_INVENTORY_COLUMNS[key], true, `${key} should be visible`);
    }
  }
});

test("saved column settings are validated and merged with new defaults", () => {
  assert.deepEqual(parseInventoryColumnVisibility("bad-json"), DEFAULT_INVENTORY_COLUMNS);
  assert.deepEqual(
    parseInventoryColumnVisibility(JSON.stringify({ photo: false, createdAt: true, price: "no" })),
    { ...DEFAULT_INVENTORY_COLUMNS, photo: false, createdAt: true },
  );
});

test("column settings are user-scoped and drive desktop and mobile views", async () => {
  const [table, page] = await Promise.all([
    readFile(new URL("../components/ItemsTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(protected)/items/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /columnSettingsScope=\{user\.userId\}/);
  assert.match(table, /yu-inventory:item-columns:v1:\$\{columnSettingsScope\}/);
  assert.match(table, /saveColumnVisibility\(columnSettingsStorageKey, next\)/);
  assert.match(table, /setVisibleColumns\(next\)/);
  assert.match(table, /visibleColumns\.additionalInfo/);
  assert.match(table, /visibleColumns\.createdAt/);
  assert.match(table, /aria-controls="inventory-column-settings"/);
});
