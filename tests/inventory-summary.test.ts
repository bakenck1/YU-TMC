import assert from "node:assert/strict";
import test from "node:test";

import {
  inventoryLineValue,
  itemsForInventorySummary,
  summarizeInventory,
} from "../lib/inventory-summary";
import type { InventoryItem } from "../lib/types";

const BASE_ITEM: InventoryItem = {
  id: "active",
  name: "Projector",
  inventoryNumber: "INV-1",
  category: "Оргтехника",
  location: "Main / 301",
  responsible: "Employee",
  status: "active",
  photoColor: "#000",
  quantity: 3,
  price: 100,
};

const ITEMS: InventoryItem[] = [
  BASE_ITEM,
  {
    ...BASE_ITEM,
    id: "maintenance",
    status: "maintenance",
    quantity: 2,
    price: 50,
  },
  {
    ...BASE_ITEM,
    id: "decommissioned",
    status: "decommissioned",
    quantity: 10,
    price: 0,
  },
];

test("summaries count records while total value respects quantity", () => {
  assert.deepEqual(summarizeInventory(ITEMS), {
    totalValue: 400,
    totalItems: 3,
    maintenance: 1,
    decommissioned: 1,
  });
  assert.equal(inventoryLineValue(BASE_ITEM), 300);
});

test("accordion datasets match their summary category", () => {
  assert.deepEqual(
    itemsForInventorySummary(ITEMS, "maintenance").map((item) => item.id),
    ["maintenance"],
  );
  assert.deepEqual(
    itemsForInventorySummary(ITEMS, "decommissioned").map((item) => item.id),
    ["decommissioned"],
  );
  assert.equal(itemsForInventorySummary(ITEMS, "totalValue").length, 3);
  assert.equal(itemsForInventorySummary(ITEMS, "totalItems").length, 3);
});
