import assert from "node:assert/strict";
import test from "node:test";
import { isOneCConsumable } from "../lib/one-c-consumables";
import { isOneCExcludedSource } from "../lib/one-c-integration-scope";
import { consumables, retainedEquipment } from "./helpers/one-c-consumable-cases";

test("excludes the approved consumables and preserves equipment mentioning supplies", () => {
  for (const name of consumables) assert.equal(isOneCConsumable(name), true, name);
  for (const name of retainedEquipment) assert.equal(isOneCConsumable(name), false, name);
});

test("retains reviewed exclusions after a fixed asset is renamed", () => {
  assert.equal(isOneCExcludedSource("Новая запись", "D895592F-EC33-11EA-9A99-DAF44A7F39D0"), true);
  assert.equal(isOneCExcludedSource("Компьютер", "00000000-0000-4000-8000-000000000001"), false);
});
