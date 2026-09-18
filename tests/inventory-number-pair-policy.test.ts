import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { code39PayloadForItem } from "../lib/domain/code39";
import {
  needsUniqueItemBarcode,
  sharedInventoryNumberDevice,
} from "../lib/inventory-number-pair-policy";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

test("only monitor and system-unit names opt into the shared-number pair", () => {
  for (const value of ["Монитор", "  МОНИТОР Dell  ", "monitor HP"]) {
    assert.equal(sharedInventoryNumberDevice(value), "monitor", value);
  }
  for (const value of ["Системный блок", "system unit Dell", "Жүйелік блок HP"]) {
    assert.equal(sharedInventoryNumberDevice(value), "system_unit", value);
  }
  for (const value of ["Моноблок", "monoblock", "Мониторная стойка", "Ноутбук", ""]) {
    assert.equal(sharedInventoryNumberDevice(value), null, value);
  }
});

test("pair-capable items always receive distinct scan-safe barcodes", () => {
  assert.equal(needsUniqueItemBarcode("Монитор Dell"), true);
  const first = code39PayloadForItem("111/111-2", FIRST_ID, true);
  const second = code39PayloadForItem("111/111-2", SECOND_ID, true);
  assert.notEqual(first, second);
  assert.match(first, /^YUI-[0-9A-F]{16}$/);
  assert.match(second, /^YUI-[0-9A-F]{16}$/);
});

test("database migration enforces the exact pair and serializes concurrent inserts", () => {
  const migration = readFileSync(
    new URL("../drizzle/20260918121755_striped_black_knight.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /existing_count = 1/);
  assert.match(migration, /new_device <> existing_device/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF inventory_number_key, name/);
  assert.match(migration, /PRIMARY KEY\("canonical_key","item_id"\)/);
  assert.match(migration, /kind = 'local'/);
});
