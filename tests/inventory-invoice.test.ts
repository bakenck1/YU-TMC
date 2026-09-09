import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInventoryInvoiceHtml,
  inventoryInvoiceQuantity,
} from "../lib/inventory-invoice";
import type { InventoryItem } from "../lib/types";

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "item-1",
    name: "Моноблок",
    inventoryNumber: "INV-001",
    category: "electronics",
    location: "Корпус A / 101",
    responsible: "Иванов Иван",
    status: "active",
    photoColor: "#000000",
    quantity: 20,
    price: 125_000,
    ...overrides,
  };
}

test("invoice carries the full selected quantity and calculated amount", () => {
  const selected = [item()];
  const html = buildInventoryInvoiceHtml({
    variant: "large",
    items: selected,
    invoiceNumber: "42",
    date: "2026-09-09",
    supplier: "Yessenov University",
    recipient: "Иванов Иван",
  });

  assert.equal(inventoryInvoiceQuantity(selected), 20);
  assert.match(html, /<td class="center">20<\/td>/);
  assert.match(html, /2(?:&nbsp;|\u00a0|\s)500(?:&nbsp;|\u00a0|\s)000,00/);
  assert.match(html, /«<span class="line day">09<\/span>»/);
  assert.match(html, /сентября/);
});

test("small invoice prints two copies and paginates selections by twelve lines", () => {
  const items = Array.from({ length: 13 }, (_, index) => item({
    id: `item-${index}`,
    inventoryNumber: `INV-${index}`,
  }));
  const html = buildInventoryInvoiceHtml({
    variant: "small",
    items,
    invoiceNumber: "",
    date: "",
    supplier: "",
    recipient: "",
  });

  assert.equal((html.match(/data-invoice-page=/g) ?? []).length, 2);
  assert.equal((html.match(/data-invoice-copy=/g) ?? []).length, 4);
  assert.equal((html.match(/INV-12/g) ?? []).length, 2);
});

test("invoice escapes values before writing the printable document", () => {
  const html = buildInventoryInvoiceHtml({
    variant: "large",
    items: [item({ name: "<script>alert(1)</script>" })],
    invoiceNumber: "<42>",
    date: "2026-09-09",
    supplier: "A & B",
    recipient: 'Иванов "И.И."',
  });

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /Иванов &quot;И\.И\.&quot;/);
});
