import type { InventoryItem } from "@/lib/types";

export type InventoryInvoiceVariant = "small" | "large";

export interface InventoryInvoiceDetails {
  invoiceNumber: string;
  date: string;
}

export interface InventoryInvoiceDocumentInput extends InventoryInvoiceDetails {
  variant: InventoryInvoiceVariant;
  items: readonly InventoryItem[];
}

const SMALL_ROWS_PER_COPY = 12;
const LARGE_ROWS_PER_PAGE = 39;

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

export function inventoryInvoiceQuantity(items: readonly InventoryItem[]) {
  return items.reduce((total, item) => total + itemQuantity(item), 0);
}

export function buildInventoryInvoiceHtml({
  variant,
  items,
  invoiceNumber,
  date,
}: InventoryInvoiceDocumentInput) {
  const details = { invoiceNumber, date };
  const pages = variant === "small"
    ? chunk(items, SMALL_ROWS_PER_COPY).map(
        (pageItems, pageIndex) => `
          <section class="sheet small-sheet" data-invoice-page="${pageIndex + 1}">
            ${renderInvoice("small", pageItems, details, SMALL_ROWS_PER_COPY, `${pageIndex + 1}-a`)}
            ${renderInvoice("small", pageItems, details, SMALL_ROWS_PER_COPY, `${pageIndex + 1}-b`)}
          </section>`,
      )
    : chunk(items, LARGE_ROWS_PER_PAGE).map(
        (pageItems, pageIndex) => `
          <section class="sheet large-sheet" data-invoice-page="${pageIndex + 1}">
            ${renderInvoice("large", pageItems, details, LARGE_ROWS_PER_PAGE, `${pageIndex + 1}`)}
          </section>`,
      );

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Накладная${invoiceNumber.trim() ? ` № ${escapeHtml(invoiceNumber.trim())}` : ""}</title>
  <style>${INVOICE_STYLES}</style>
</head>
<body>
  ${pages.join("\n")}
</body>
</html>`;
}

function renderInvoice(
  variant: InventoryInvoiceVariant,
  items: readonly InventoryItem[],
  details: InventoryInvoiceDetails,
  rowCapacity: number,
  copyId: string,
) {
  const rows = items.map(renderItemRow);
  while (rows.length < rowCapacity) {
    rows.push("<tr class=\"blank-row\"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>");
  }

  return `<article class="invoice invoice-${variant}" data-invoice-copy="${copyId}">
    <header>
      <div class="invoice-title">НАКЛАДНАЯ №<span class="line invoice-number">${escapeHtml(details.invoiceNumber)}</span></div>
      <div class="invoice-date"><span class="date-label">Дата выписки:</span> «<span class="line day">${escapeHtml(formattedDate(details.date).day)}</span>»<span class="line month">${escapeHtml(formattedDate(details.date).month)}</span><span class="line year">${escapeHtml(formattedDate(details.date).year)}</span> г.</div>
    </header>
    <table>
      <colgroup><col class="name-col"><col class="code-col"><col class="unit-col"><col class="quantity-col"><col class="price-col"><col class="sum-col"></colgroup>
      <thead><tr><th>Наименование</th><th>Шифр</th><th>Ед.<br>изм.</th><th>Кол-<br>во</th><th>Цена</th><th>Сумма</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </article>`;
}

function renderItemRow(item: InventoryItem) {
  const quantity = itemQuantity(item);
  const price = item.price;
  const total = typeof price === "number" && Number.isFinite(price)
    ? price * quantity
    : null;
  return `<tr>
    <td class="item-name">${escapeHtml(item.name)}</td>
    <td class="item-code">${escapeHtml(item.inventoryNumber)}</td>
    <td class="center">шт.</td>
    <td class="center">${quantity}</td>
    <td class="number">${formatMoney(price)}</td>
    <td class="number">${formatMoney(total)}</td>
  </tr>`;
}

function formattedDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { day: "", month: "", year: "20__" };
  const monthIndex = Number(match[2]) - 1;
  return {
    day: String(Number(match[3])).padStart(2, "0"),
    month: RU_MONTHS[monthIndex] ?? "",
    year: match[1],
  };
}

function itemQuantity(item: InventoryItem) {
  const quantity = item.quantity ?? 1;
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const INVOICE_STYLES = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e5e7eb; color: #000; font-family: "Times New Roman", Times, serif; }
  .sheet { width: 210mm; height: 297mm; margin: 10mm auto; overflow: hidden; background: #fff; break-after: page; page-break-after: always; }
  .sheet:last-of-type { break-after: auto; page-break-after: auto; }
  .large-sheet { padding: 17mm 14mm 14mm; }
  .small-sheet { display: flex; flex-direction: column; gap: 7mm; padding: 8mm 14mm 7mm; }
  .invoice { display: flex; flex-direction: column; width: 100%; }
  .invoice-large { height: 266mm; font-size: 11pt; }
  .invoice-small { height: 134mm; font-size: 9pt; }
  .invoice header { flex: 0 0 auto; }
  .invoice-title { text-align: center; white-space: nowrap; }
  .invoice-large .invoice-title { font-size: 13pt; }
  .invoice-small .invoice-title { font-size: 11pt; }
  .line { display: inline-flex; min-height: 1.2em; align-items: flex-end; border-bottom: .3mm solid #000; padding: 0 1.5mm .2mm; }
  .invoice-number { min-width: 38mm; justify-content: center; }
  .invoice-date { margin-top: 1.5mm; text-align: center; white-space: nowrap; }
  .date-label { margin-right: 2mm; }
  .invoice-date .day { min-width: 14mm; justify-content: center; }
  .invoice-date .month { min-width: 58mm; justify-content: center; }
  .invoice-date .year { min-width: 16mm; justify-content: center; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  .invoice-large table { margin-top: 5mm; font-size: 9.5pt; }
  .invoice-small table { margin-top: 4mm; font-size: 7.5pt; }
  th, td { border: .25mm solid #000; padding: .45mm 1mm; vertical-align: middle; line-height: 1.05; }
  th { text-align: center; font-weight: 400; }
  .invoice-large th { height: 10mm; font-size: 10pt; }
  .invoice-small th { height: 8mm; font-size: 8pt; }
  .invoice-large tbody tr { height: 5mm; }
  .invoice-small tbody tr { height: 4.6mm; }
  .name-col { width: 52%; } .code-col { width: 11%; } .unit-col { width: 7%; } .quantity-col { width: 7%; } .price-col { width: 10%; } .sum-col { width: 13%; }
  .item-name, .item-code { overflow-wrap: anywhere; }
  .invoice-large .item-code { padding-left: .5mm; padding-right: .5mm; font-size: 7.25pt; white-space: nowrap; overflow-wrap: normal; }
  .center { text-align: center; }
  .number { text-align: right; white-space: nowrap; }
  @media print {
    html, body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; }
  }
  @media screen {
    .sheet { box-shadow: 0 8px 30px rgba(0,0,0,.18); }
  }
`;
