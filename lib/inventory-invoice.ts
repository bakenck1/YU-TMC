import type { InventoryItem } from "@/lib/types";

export type InventoryInvoiceVariant = "small" | "large";

export interface InventoryInvoiceDetails {
  invoiceNumber: string;
  date: string;
  supplier?: string;
  recipient?: string;
}

export interface InventoryInvoiceDocumentInput extends InventoryInvoiceDetails {
  variant: InventoryInvoiceVariant;
  items: readonly InventoryItem[];
}

const SMALL_ROWS_PER_COPY = 12;
const LARGE_ROWS_PER_PAGE = 12;

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
  supplier,
  recipient,
}: InventoryInvoiceDocumentInput) {
  const details = { invoiceNumber, date, supplier, recipient };
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
    rows.push("<tr class=\"blank-row\"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>");
  }

  return `<article class="invoice invoice-${variant}" data-invoice-copy="${copyId}">
    <header>
      <div class="invoice-title">НАКЛАДНАЯ №<span class="line invoice-number">${escapeHtml(details.invoiceNumber)}</span></div>
      <div class="invoice-date">«<span class="line day">${escapeHtml(formattedDate(details.date).day)}</span>»<span class="line month">${escapeHtml(formattedDate(details.date).month)}</span><span class="line year">${escapeHtml(formattedDate(details.date).year)}</span> г.</div>
      <div class="party">Поставщик<span class="line party-value">${escapeHtml(details.supplier ?? "")}</span></div>
      <div class="party">Получатель<span class="line party-value">${escapeHtml(details.recipient ?? "")}</span></div>
    </header>
    <table>
      <colgroup><col class="name-col"><col class="account-col"><col class="code-col"><col class="unit-col"><col class="quantity-col"><col class="price-col"><col class="sum-col"></colgroup>
      <thead><tr><th>Наименование</th><th>Счет<br>учета</th><th>Код<br>номер</th><th>ед.<br>изм.</th><th>кол-<br>во</th><th>цена</th><th>сумма</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    <footer>
      ${renderSignature("Принял(а)")}
      ${renderSignature("Отпустил(а)")}
    </footer>
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
    <td></td>
    <td class="item-code">${escapeHtml(item.inventoryNumber)}</td>
    <td class="center">шт.</td>
    <td class="center">${quantity}</td>
    <td class="number">${formatMoney(price)}</td>
    <td class="number">${formatMoney(total)}</td>
  </tr>`;
}

function renderSignature(label: string) {
  return `<div class="signature"><span>${label}</span><span class="signature-field signature-mark"><span class="line"></span><small>(Подпись)</small></span><span>/</span><span class="signature-field signature-name"><span class="line"></span><small>(Ф.И.О.)</small></span></div>`;
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
  .sheet { width: 210mm; min-height: 297mm; margin: 10mm auto; background: #fff; break-after: page; page-break-after: always; }
  .sheet:last-of-type { break-after: auto; page-break-after: auto; }
  .large-sheet { padding: 17mm 14mm 14mm; }
  .small-sheet { display: flex; flex-direction: column; gap: 7mm; padding: 8mm 14mm 7mm; }
  .invoice { display: flex; flex-direction: column; width: 100%; break-inside: avoid; page-break-inside: avoid; }
  .invoice-large { min-height: 266mm; font-size: 12pt; }
  .invoice-small { min-height: 134mm; font-size: 9pt; }
  .invoice header { flex: 0 0 auto; }
  .invoice-title { text-align: center; white-space: nowrap; }
  .invoice-large .invoice-title { font-size: 13pt; }
  .invoice-small .invoice-title { font-size: 11pt; }
  .line { display: inline-flex; min-height: 1.2em; align-items: flex-end; border-bottom: .3mm solid #000; padding: 0 1.5mm .2mm; }
  .invoice-number { display: inline-block; min-width: 38mm; max-width: 95mm; white-space: normal; overflow-wrap: anywhere; text-align: center; }
  .invoice-date { margin-top: 1.5mm; text-align: center; white-space: nowrap; }
  .party { display: flex; align-items: baseline; gap: 1mm; margin-top: 1mm; }
  .party-value { flex: 1; overflow-wrap: anywhere; }
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
  .invoice-large tbody tr { height: 13mm; }
  .invoice-small tbody tr { height: 4.6mm; }
  .name-col { width: 46%; } .account-col { width: 7%; } .code-col { width: 9%; } .unit-col { width: 5%; } .quantity-col { width: 5%; } .price-col { width: 12%; } .sum-col { width: 16%; }
  .item-name, .item-code { overflow-wrap: anywhere; }
  .invoice-large .item-code { padding-left: .5mm; padding-right: .5mm; font-size: 8pt; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  footer { margin-top: 5mm; break-inside: avoid; page-break-inside: avoid; }
  .signature { display: flex; align-items: baseline; margin-top: 4mm; margin-left: 12%; }
  .signature-field { display: flex; flex-direction: column; text-align: center; }
  .signature-mark { width: 30%; }
  .signature-name { flex: 1; }
  .signature-field small { font-size: .65em; margin-top: .5mm; }
  .invoice-small footer { margin-top: 2mm; }
  .invoice-small .signature { margin-top: 2mm; }
  .center { text-align: center; overflow-wrap: anywhere; }
  .number { text-align: right; white-space: nowrap; }
  @media print {
    html, body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; }
  }
  @media screen {
    .sheet { box-shadow: 0 8px 30px rgba(0,0,0,.18); }
  }
`;
