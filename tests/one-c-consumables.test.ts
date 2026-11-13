import assert from "node:assert/strict";
import test from "node:test";
import { isOneCConsumable } from "../lib/one-c-consumables";
import { isOneCExcludedSource } from "../lib/one-c-integration-scope";
import { consumables, retainedEquipment } from "./helpers/one-c-consumable-cases";

test("excludes the approved consumables and preserves equipment mentioning supplies", () => {
  for (const name of consumables) assert.equal(isOneCConsumable(name), true, name);
  for (const name of retainedEquipment) assert.equal(isOneCConsumable(name), false, name);
  for (const name of ["Колба мерная", "Пипетка градуированная", "Стаканчик для взвешивания", "Лабораторная посуда", "Химическая посуда ОХТ №1350/16056 от 04.11.24"]) {
    assert.equal(isOneCExcludedSource(name, null, "new-code"), false, name);
  }
});

test("retains reviewed exclusions after a fixed asset is renamed", () => {
  assert.equal(isOneCExcludedSource("Новая запись", "D895592F-EC33-11EA-9A99-DAF44A7F39D0"), true);
  assert.equal(isOneCExcludedSource("Новая запись", "c426bcdd-e8bf-11e8-951e-002522bd9fc7"), true);
  assert.equal(isOneCExcludedSource("Компьютер", "00000000-0000-4000-8000-000000000001"), false);
});
