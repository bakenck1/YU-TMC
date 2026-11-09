import assert from "node:assert/strict";
import test from "node:test";

import type { InventoryListFilters } from "../lib/inventory-list";
import {
filterInventoryItems,
inventoryStatusOptions,
} from "../lib/inventory-list";
import { toLocalBarcodeInventoryItem } from "../lib/local-barcode-item-view";
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
  brand: "Epson",
  model: "EB-X49",
  itemType: "Проектор",
  building: "Main Campus",
  room: "301",
};

test("room filters return both scripts for a letter and preserve exact room-number matching", () => {
  const pairs = [["А", "A"], ["В", "B"], ["Е", "E"], ["К", "K"], ["М", "M"], ["Н", "H"], ["О", "O"], ["Р", "P"], ["С", "C"], ["Т", "T"], ["У", "Y"], ["Х", "X"], ["І", "I"]];
  const filters = { query: "", category: "all", location: "all", statusKey: "all" };
  for (const [cyrillic, latin] of pairs) {
    const items = [
      { ...BASE_ITEM, id: "latin", room: `${latin}201` },
      { ...BASE_ITEM, id: "cyrillic", room: `${cyrillic}201` },
      { ...BASE_ITEM, id: "longer-number", room: `${cyrillic}2010` },
      { ...BASE_ITEM, id: "other-wing", room: "F201" },
    ];
    for (const letter of [cyrillic, latin, cyrillic.toLowerCase(), latin.toLowerCase()]) {
      assert.deepEqual(filterInventoryItems(items, { ...filters, room: letter })
        .map((item) => item.id), ["latin", "cyrillic", "longer-number"]);
      assert.deepEqual(filterInventoryItems(items, { ...filters, room: `${letter}201` })
        .map((item) => item.id), ["latin", "cyrillic"]);
    }
  }
});

test("room filters normalize mixed-script suffixes and legacy location fields", () => {
  const items = [
    { ...BASE_ITEM, id: "mixed", room: "АBС-001" },
    { ...BASE_ITEM, id: "suffix", room: "201 Е" },
    { ...BASE_ITEM, id: "legacy", room: undefined, location: "Main Campus / E201" },
  ];
  const filters = { query: "", category: "all", location: "all", statusKey: "all" };
  for (const [query, expectedId] of [["abc-001", "mixed"], ["201 e", "suffix"], ["е201", "legacy"]]) {
    assert.deepEqual(filterInventoryItems(items, { ...filters, room: query })
      .map((item) => item.id), [expectedId]);
  }
});

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
  { name: "room", filter: { location: "301" }, mismatch: { room: "205", location: "Main / 205" } },
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

test("location filter finds a floor in the full location when a separate room is present", () => {
  const thirteenthFloor: InventoryItem = {
    ...BASE_ITEM,
    id: "floor-13",
    inventoryNumber: "INV-13",
    room: "1301",
    location: "The Main Campus / 13 этаж / 1301",
  };
  const twelfthFloor: InventoryItem = {
    ...BASE_ITEM,
    id: "floor-12",
    inventoryNumber: "INV-12",
    room: "1201",
    location: "The Main Campus / 12 этаж / 1201",
  };

  const result = filterInventoryItems([thirteenthFloor, twelfthFloor], {
    query: "",
    category: "all",
    location: "  13   ЭТАЖ ",
    statusKey: "all",
  });

  assert.deepEqual(result.map((item) => item.id), ["floor-13"]);
});

test("location filter treats hyphenated floor input as an inclusive range", () => {
  const floorItems = Array.from({ length: 16 }, (_, floorNumber): InventoryItem => ({
    ...BASE_ITEM,
    id: `floor-${floorNumber}`,
    inventoryNumber: `INV-${floorNumber}`,
    floorNumber,
    room: `${floorNumber}01`,
    location: `The Main Campus / ${floorNumber} этаж / ${floorNumber}01`,
  }));
  const filters: InventoryListFilters = {
    query: "",
    category: "all",
    location: "14-15",
    statusKey: "all",
  };

  assert.deepEqual(
    filterInventoryItems(floorItems, filters).map((item) => item.floorNumber),
    [14, 15],
  );
  assert.deepEqual(
    filterInventoryItems(floorItems, { ...filters, location: "15–14 этажи" }).map((item) => item.floorNumber),
    [14, 15],
  );
});

test("floor range also finds locally distributed inventory through the database DTO mapping", () => {
  const localItem = toLocalBarcodeInventoryItem({
    id: "local-group-15",
    itemId: "item-15",
    itemName: "Моноблок",
    originalBarcode: "INV-15",
    itemType: "electronics",
    brand: "Lenovo",
    model: null,
    description: null,
    unitPrice: 100,
    photoUrl: null,
    localBarcode: "INV-15-0001",
    parentGroupId: null,
    quantity: 1,
    responsible: { id: "employee-1", fullName: "Employee" },
    previousResponsible: null,
    location: {
      roomId: "room-1501",
      roomDesignation: "1501",
      floorNumber: 15,
      buildingId: "main-campus",
      buildingName: "The Main Campus",
    },
    transferredAt: "2026-09-09T00:00:00.000Z",
    status: "active",
    version: 1,
    cancellation: null,
  });

  assert.equal(localItem.floorNumber, 15);
  assert.equal(localItem.location, "The Main Campus / 15 этаж / 1501");
  assert.deepEqual(
    filterInventoryItems([localItem], {
      query: "",
      category: "all",
      location: "14-15",
      statusKey: "all",
    }).map((item) => item.id),
    ["local-group-15"],
  );
});
