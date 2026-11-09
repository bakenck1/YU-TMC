import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInventoryExportPayload, isCompleteInventoryExport } from "../lib/inventory-export";
import { DEFAULT_INVENTORY_COLUMNS } from "../lib/inventory-columns";
import { filterInventoryItems } from "../lib/inventory-list";
import { hasPermission } from "../lib/security/permissions";
import type { InventoryItem } from "../lib/types";

const excelRoute = readFileSync("app/api/inventory/excel/route.ts", "utf8");

test("admin and warehouse retain inventory export permission", () => {
  assert.equal(hasPermission("admin", "inventory.report.export"), true);
  assert.equal(hasPermission("warehouse", "inventory.report.export"), true);
  assert.equal(hasPermission("employee", "inventory.report.export"), false);
});

test("POST payload contains only filtered item ids and visible columns", () => {
  const items = [
    inventoryItem("item-1", "Projector", "Building A / 101"),
    inventoryItem("item-2", "Printer", "Building B / 202"),
  ];
  const filtered = filterInventoryItems(items, {
    query: "projector",
    category: "all",
    location: "all",
    statusKey: "all",
  });
  const columns = {
    ...DEFAULT_INVENTORY_COLUMNS,
    location: false,
    additionalInfo: true,
  };

  assert.deepEqual(
    createInventoryExportPayload(
      "items",
      filtered.map((item) => item.id),
      columns,
    ),
    {
      dataset: "items",
      itemIds: ["item-1"],
      columns: [
        "name",
        "inventoryNumber",
        "oneCCode",
        "qrCode",
        "itemType",
        "brand",
        "model",
        "status",
        "responsible",
        "description",
        "quantity",
        "unitPrice",
        "total",
        "updatedAt",
        "exportedAt",
      ],
    },
  );
});

test("complete dataset export omits the bounded selection list", () => {
  const payload = createInventoryExportPayload(
    "items",
    Array.from({ length: 25_000 }, (_, index) => `item-${index}`),
    DEFAULT_INVENTORY_COLUMNS,
    true,
  );
  assert.equal("itemIds" in payload, false);
});

test("inventory export never broadens an active filter that currently matches every row", () => {
  assert.equal(isCompleteInventoryExport(true, "", 0), true);
  assert.equal(isCompleteInventoryExport(true, "projector", 0), false);
  assert.equal(isCompleteInventoryExport(true, "", 1), false);
  assert.equal(isCompleteInventoryExport(false, "", 0), false);
});

test("filtered export fails explicitly instead of silently truncating ids", () => {
  assert.throws(
    () => createInventoryExportPayload(
      "items",
      Array.from({ length: 2_001 }, (_, index) => `item-${index}`),
      DEFAULT_INVENTORY_COLUMNS,
    ),
    /inventory_export_selection_too_large/,
  );
  assert.doesNotMatch(excelRoute, /rawItemIds\.filter\(isUuid\)\.slice/);
  assert.match(excelRoute, /rawItemIds\.length > 2_000/);
});

function inventoryItem(id: string, name: string, location: string): InventoryItem {
  return {
    id,
    name,
    inventoryNumber: `INV-${id}`,
    category: "Компьютеры" as InventoryItem["category"],
    location,
    responsible: "Employee",
    status: "active",
    photoColor: "bg-zinc-100",
  };
}
