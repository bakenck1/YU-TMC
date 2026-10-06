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
  });

  assert.equal(inventoryInvoiceQuantity(selected), 20);
  assert.match(html, /<td class="center">20<\/td>/);
  assert.match(html, /2(?:&nbsp;|\u00a0|\s)500(?:&nbsp;|\u00a0|\s)000,00/);
  assert.match(html, /«<span class="line day">09<\/span>»/);
  assert.match(html, /сентября/);
  assert.doesNotMatch(html, /Дата выписки:/);
  assert.match(html, /Поставщик/);
  assert.match(html, /Получатель/);
  assert.match(html, /Принял\(а\)/);
  assert.match(html, /Отпустил\(а\)/);
  assert.match(html, /\(Подпись\)/);
  assert.match(html, /\(Ф.И.О.\)/);
  assert.equal((html.match(/<th>/g) ?? []).length, 7);
  assert.match(html, /Счет<br>учета/);
  assert.match(html, /Код<br>номер/);
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
  });

  assert.equal((html.match(/data-invoice-page=/g) ?? []).length, 2);
  assert.equal((html.match(/data-invoice-copy=/g) ?? []).length, 4);
  assert.equal((html.match(/INV-12/g) ?? []).length, 2);
});

test("invoice escapes values before writing the printable document", () => {
  const html = buildInventoryInvoiceHtml({
    variant: "large",
    items: [item({ name: "<script>alert(1)</script>" })],
    invoiceNumber: '<42>&"',
    date: "2026-09-09",
    supplier: '<img src=x onerror="alert(1)">',
    recipient: "Получатель & партнёры",
  });

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;42&gt;&amp;&quot;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Получатель &amp; партнёры/);
});

test("large invoice retains every selected item over multiple twelve-row pages", () => {
  const html = buildInventoryInvoiceHtml({ variant: "large", invoiceNumber: "", date: "",
    items: Array.from({ length: 25 }, (_, index) => item({ inventoryNumber: `CODE-${index}` })),
  });
  assert.equal((html.match(/data-invoice-page=/g) ?? []).length, 3);
  for (let index = 0; index < 25; index += 1) assert.match(html, new RegExp(`>CODE-${index}<`));
  assert.doesNotMatch(html, /overflow: hidden/);
});

test("the code column retains the inventory number and never invents an accounting account", () => {
  const html = buildInventoryInvoiceHtml({ variant: "large", invoiceNumber: "", date: "",
    items: [item({ oneCCode: "000002864" })],
  });
  assert.match(html, /<td><\/td>\s*<td class="item-code">INV-001<\/td>/);
});
