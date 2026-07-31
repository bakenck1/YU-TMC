import assert from "node:assert/strict";
import test from "node:test";

import {
  filterDecommissionedItems,
  inventoryItemBuilding,
} from "../lib/decommissioned-items";
import type { InventoryItem } from "../lib/types";

const BASE_ITEM: InventoryItem = {
  id: "1",
  name: "Проектор Epson",
  inventoryNumber: "INV-42",
  category: "Оргтехника",
  location: "Главный корпус / 301",
  responsible: "Demo User 4",
  status: "decommissioned",
  photoColor: "#000",
  itemType: "Проектор",
  brandModel: "Epson EB-X49",
  updatedAt: "15.07.2026",
  updatedAtIso: "2026-07-15T10:30:00.000Z",
  decommissionedOn: "2026-07-15",
};

test("extracts the building without including the room", () => {
  assert.equal(inventoryItemBuilding(BASE_ITEM), "Главный корпус");
});

test("filters by search, building, responsible and inclusive date range", () => {
  const result = filterDecommissionedItems(
    [
      BASE_ITEM,
      {
        ...BASE_ITEM,
        id: "2",
        inventoryNumber: "INV-99",
        responsible: "Другой сотрудник",
      },
    ],
    {
      query: "epson",
      building: "Главный корпус",
      responsible: "Demo User 4",
      dateFrom: "2026-07-15",
      dateTo: "2026-07-15",
    },
  );
  assert.deepEqual(result.map((item) => item.id), ["1"]);
});

test("never admits active or maintenance items", () => {
  const result = filterDecommissionedItems(
    [
      { ...BASE_ITEM, id: "active", status: "active" },
      { ...BASE_ITEM, id: "maintenance", status: "maintenance" },
    ],
    {
      query: "",
      building: "all",
      responsible: "all",
      dateFrom: "",
      dateTo: "",
    },
  );
  assert.deepEqual(result, []);
});

test("excludes undated records when a date boundary is selected", () => {
  const result = filterDecommissionedItems(
    [{ ...BASE_ITEM, decommissionedOn: undefined }],
    {
      query: "",
      building: "all",
      responsible: "all",
      dateFrom: "2026-01-01",
      dateTo: "",
    },
  );
  assert.deepEqual(result, []);
});
