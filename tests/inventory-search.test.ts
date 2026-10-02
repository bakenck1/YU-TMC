import assert from "node:assert/strict";
import test from "node:test";

import { filterInventoryItems, type InventoryListFilters } from "../lib/inventory-list";
import { code39PayloadForItem } from "../lib/domain/code39";
import type { InventoryItem } from "../lib/types";

const BASE: InventoryItem = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Моноблок",
  inventoryNumber: "000123",
  oneCCode: "000987",
  qrCode: "QR-EXCEL",
  category: "electronics",
  location: "Main / 101",
  responsible: "Employee",
  status: "active",
  photoColor: "#000",
};
const FILTERS: InventoryListFilters = {
  query: "", category: "all", location: "all", statusKey: "all",
};
const find = (items: InventoryItem[], query: string) =>
  filterInventoryItems(items, { ...FILTERS, query }).map((item) => item.id);

test("name search retains every matching record across sources and whitespace variants", () => {
  const items = [BASE, { ...BASE, id: "excel", name: " МОНОБЛОК  Lenovo " },
    { ...BASE, id: "one-c", name: "Моноблок\u00a0Lenovo" },
    { ...BASE, id: "printer", name: "Принтер" }];
  assert.deepEqual(find(items, "  МОНОБЛОК "), [BASE.id, "excel", "one-c"]);
  assert.deepEqual(find(items, "моноблок Lenovo"), ["excel", "one-c"]);
});

test("search finds 1C codes as well as inventory numbers and QR codes and preserves leading zeros", () => {
  for (const query of ["000987", "０００９８７", "000123", "QR-EXCEL"]) {
    assert.deepEqual(find([BASE], query), [BASE.id]);
  }
  assert.deepEqual(find([{ ...BASE, oneCCode: "987" }], "000987"), []);
});

test("search finds printed unique barcodes and legacy scanner wrappers", () => {
  const monitor = { ...BASE, name: "Монитор", inventoryNumber: "123/361" };
  const systemUnit = { ...BASE, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Системный блок", inventoryNumber: "123/361" };
  const items = [monitor, systemUnit];
  assert.deepEqual(find(items, "123/361"), items.map((item) => item.id));
  const barcode = code39PayloadForItem(monitor.inventoryNumber, monitor.id, true);
  assert.deepEqual(find(items, barcode), [monitor.id]);
  assert.deepEqual(find(items, `*${barcode}*`), [monitor.id]);
  assert.deepEqual(find(items, "YUB-123/361"), items.map((item) => item.id));
  assert.deepEqual(find(items, "*123/361*"), items.map((item) => item.id));
  assert.deepEqual(find(items, "YUI-CCCCCCCCCCCCCCCC"), []);
});

test("code search keeps applied filters and does not match a source barcode to a local group", () => {
  const group = { ...BASE, id: "local", localGroupId: "local", sourceItemId: BASE.id, inventoryNumber: "LOCAL-001", oneCCode: undefined, qrCode: undefined };
  assert.deepEqual(find([BASE, group], "LOCAL-001"), ["local"]);
  assert.deepEqual(filterInventoryItems([BASE], { ...FILTERS, query: "000987", room: "202" }), []);
});

test("search finds published source codes and barcodes independently of the official inventory number", () => {
  const published = { ...BASE, id: "one-c", searchIdentifiers: ["1C-000045", "0000012345678"] };
  assert.deepEqual(find([BASE, published], "1C-000045"), ["one-c"]);
  assert.deepEqual(find([BASE, published], "0000012345678"), ["one-c"]);
  assert.deepEqual(find([BASE, published], "*0000012345678*"), ["one-c"]);
  assert.deepEqual(find([{ ...published, searchIdentifiers: ["12345678"] }], "0000012345678"), []);
});

test("published source names find linked Excel items without changing their displayed name", () => {
  const linked = { ...BASE, searchNames: ["Моноблок Lenovo ThinkCentre"] };
  assert.deepEqual(find([linked], "thinkcentre"), [BASE.id]);
  assert.deepEqual(find([linked], "МОНОБЛОК LENOVO"), [BASE.id]);
  assert.equal(linked.name, "Моноблок");
});
