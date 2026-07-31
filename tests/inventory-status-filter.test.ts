import assert from "node:assert/strict";
import test from "node:test";

import {
  filterInventoryItems,
  inventoryStatusOptions,
} from "../lib/inventory-list";
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
};

test("always exposes the decommissioned lifecycle status option", () => {
  const keys = inventoryStatusOptions([BASE_ITEM]).map((option) => option.key);
  assert.ok(keys.includes("lifecycle:decommissioned"));
});

test("filters the general inventory list to decommissioned items", () => {
  const result = filterInventoryItems(
    [
      BASE_ITEM,
      {
        ...BASE_ITEM,
        id: "decommissioned",
        inventoryNumber: "INV-2",
        status: "decommissioned",
        displayStatus: "Требует присвоения номера",
      },
    ],
    {
      query: "",
      category: "all",
      location: "all",
      statusKey: "lifecycle:decommissioned",
    },
  );

  assert.deepEqual(result.map((item) => item.id), ["decommissioned"]);
});

test("keeps display status available as an independent filter", () => {
  const temporaryItem = {
    ...BASE_ITEM,
    displayStatus: "Требует присвоения номера",
  };

  assert.deepEqual(
    filterInventoryItems([temporaryItem], {
      query: "",
      category: "all",
      location: "all",
      statusKey: "display:Требует присвоения номера",
    }),
    [temporaryItem],
  );
});
