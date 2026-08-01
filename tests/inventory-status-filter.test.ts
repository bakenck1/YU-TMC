import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterInventoryItems,
  inventoryStatusOptions,
} from "../lib/inventory-list";
import type { InventoryItem } from "../lib/types";
import type { InventoryListFilters } from "../lib/inventory-list";

const BASE_ITEM: InventoryItem = {
  id: "active",
  name: "Projector",
  inventoryNumber: "INV-1",
  category: "Оргтехника",
  location: "Main / 301",
  responsible: "Employee",
  status: "active",
  photoColor: "#000",
  brand: "Epson",
  model: "EB-X49",
  itemType: "Проектор",
  building: "Main Campus",
  room: "301",
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

const FILTER_CASES: Array<{
  name: string;
  filter: Partial<InventoryListFilters>;
  mismatch: Partial<InventoryItem>;
}> = [
  { name: "brand", filter: { brand: "eps" }, mismatch: { brand: "HP" } },
  { name: "model", filter: { model: "x49" }, mismatch: { model: "ProOne" } },
  { name: "item type", filter: { itemType: "проек" }, mismatch: { itemType: "Моноблок" } },
  { name: "building", filter: { building: "main" }, mismatch: { building: "Technopark" } },
  { name: "room", filter: { location: "301" }, mismatch: { room: "205" } },
  { name: "responsible", filter: { responsible: "employee" }, mismatch: { responsible: "Technician" } },
];

for (const filterCase of FILTER_CASES) {
  test(`filters independently by ${filterCase.name}`, () => {
    const other = { ...BASE_ITEM, id: `other-${filterCase.name}`, ...filterCase.mismatch };
    const result = filterInventoryItems([BASE_ITEM, other], {
      query: "",
      category: "all",
      location: "all",
      statusKey: "all",
      ...filterCase.filter,
    });
    assert.deepEqual(result.map((item) => item.id), ["active"]);
  });
}

test("advanced filters support legacy combined item fields", () => {
  const legacy: InventoryItem = {
    ...BASE_ITEM,
    brand: undefined,
    model: undefined,
    building: undefined,
    room: undefined,
    itemType: undefined,
    brandModel: "Epson / EB-X49",
  };
  const result = filterInventoryItems([legacy], {
    query: "",
    category: "all",
    location: "301",
    statusKey: "all",
    brand: "epson",
    model: "x49",
    itemType: "оргтех",
    building: "main",
    responsible: "employee",
  });
  assert.deepEqual(result, [legacy]);
});

test("filter panel keeps draft state separate and restores focus after apply", async () => {
  const source = await readFile(new URL("../components/ItemsTable.tsx", import.meta.url), "utf8");
  assert.match(source, /setFilters\(draftFilters\)/);
  assert.match(source, /setPage\(1\)/);
  assert.match(source, /setFilterPanelOpen\(false\)/);
  assert.match(source, /filterButtonRef\.current\?\.focus\(\)/);
  assert.match(source, /if \(!filterPanelOpen\) setDraftFilters\(filters\)/);
  assert.match(source, /setDraftFilters\(EMPTY_TABLE_FILTERS\)[\s\S]*setFilters\(EMPTY_TABLE_FILTERS\)/);
  assert.match(source, /aria-controls="inventory-advanced-filters"/);
});
