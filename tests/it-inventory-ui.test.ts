import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_INVENTORY_COLUMNS } from "../lib/inventory-columns";
import { createInventoryExportPayload } from "../lib/inventory-export";

test("IT inventory export never requests a barcode column", () => {
  const payload = createInventoryExportPayload(
    "it-items",
    ["11111111-1111-4111-8111-111111111111"],
    { ...DEFAULT_INVENTORY_COLUMNS, qrCode: true },
  );
  assert.equal(payload.columns.includes("qrCode"), false);
});

test("IT address editor stays inside narrow dialogs", async () => {
  const source = await readFile(
    new URL("../components/ItNetworkAddressEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /min-w-0 overflow-hidden/);
  assert.match(source, /repeat\(auto-fit,minmax\(min\(100%,12rem\),1fr\)\)/);
  assert.match(source, /className="w-full min-w-0/);
});

test("IT UI exposes QR but no barcode controls", async () => {
  const [form, table, details, qrPage, route] = await Promise.all([
    "../components/InventoryItemCreateForm.tsx",
    "../components/ItemsTable.tsx",
    "../components/InventoryItemDetails.tsx",
    "../app/(protected)/it-items/[id]/qr/page.tsx",
    "../app/api/inventory/it-items/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  assert.match(form, /inventorySection !== "it"/);
  assert.match(table, /key !== "qrCode"/);
  assert.match(details, /item\.itemSection === "it"[\s\S]*printCodeLabel\("qr"\)/);
  assert.match(qrPage, /const kind = "qr" as const/);
  assert.doesNotMatch(qrPage, /kindInput/);
  assert.match(qrPage, /allowBarcode=\{false\}/);
  assert.match(route, /"barcode" in body/);
});
