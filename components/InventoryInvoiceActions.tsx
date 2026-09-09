"use client";

import { FileText, Printer, X } from "lucide-react";
import { useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import Dialog from "@/components/Dialog";
import {
  buildInventoryInvoiceHtml,
  inventoryInvoiceQuantity,
  type InventoryInvoiceVariant,
} from "@/lib/inventory-invoice";
import type { InventoryItem } from "@/lib/types";

export default function InventoryInvoiceActions({
  items,
  recipientName,
}: {
  items: InventoryItem[];
  recipientName: string;
}) {
  const { settings, t } = useAppSettings();
  const hasSelectedItems = items.length > 0;
  const [open, setOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(todayInputValue);
  const [supplier, setSupplier] = useState(settings.organizationName);
  const [recipient, setRecipient] = useState(recipientName);
  const [error, setError] = useState(false);

  function openDialog() {
    setError(false);
    setOpen(true);
  }

  function printInvoice(variant: InventoryInvoiceVariant) {
    if (!hasSelectedItems) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError(true);
      return;
    }

    const html = buildInventoryInvoiceHtml({
      variant,
      items,
      invoiceNumber,
      date,
      supplier,
      recipient,
    });
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.opener = null;
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 180);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 hover:shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-200/70 sm:w-auto"
      >
        <FileText className="h-4 w-4 text-zinc-500" aria-hidden="true" />
        {t("invoice.action")}
      </button>

      {open ? (
        <Dialog labelledBy="inventory-invoice-title" onDismiss={() => setOpen(false)} size="lg">
          <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4 sm:px-6">
            <div>
              <h2 id="inventory-invoice-title" className="text-xl font-bold text-zinc-900">{t("invoice.title")}</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                {t("invoice.selectedSummary", {
                  count: items.length,
                  quantity: inventoryInvoiceQuantity(items),
                })}
              </p>
            </div>
            <button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-zinc-100">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            <p className="text-sm leading-6 text-zinc-600">{t("invoice.hint")}</p>
            {!hasSelectedItems ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t("invoice.noSelection")}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-zinc-700">
                {t("invoice.number")}
                <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} maxLength={64} className="mt-1 min-h-11 w-full rounded-xl border border-black/10 px-3 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
              </label>
              <label className="text-sm font-medium text-zinc-700">
                {t("invoice.date")}
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-black/10 px-3 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
              </label>
            </div>
            <label className="block text-sm font-medium text-zinc-700">
              {t("invoice.supplier")}
              <input value={supplier} onChange={(event) => setSupplier(event.target.value)} maxLength={160} className="mt-1 min-h-11 w-full rounded-xl border border-black/10 px-3 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              {t("invoice.recipient")}
              <input value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={160} className="mt-1 min-h-11 w-full rounded-xl border border-black/10 px-3 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
            </label>

            {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{t("invoice.popupBlocked")}</p> : null}

            <div className="grid gap-3 border-t border-black/5 pt-5 sm:grid-cols-2">
              <button type="button" disabled={!hasSelectedItems} onClick={() => printInvoice("small")} className="flex min-h-16 items-center gap-3 rounded-2xl border border-black/10 px-4 text-left hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Printer className="h-5 w-5 shrink-0 text-zinc-500" aria-hidden="true" />
                <span><strong className="block text-zinc-900">{t("invoice.small")}</strong><span className="mt-0.5 block text-xs text-zinc-500">{t("invoice.smallHint")}</span></span>
              </button>
              <button type="button" disabled={!hasSelectedItems} onClick={() => printInvoice("large")} className="flex min-h-16 items-center gap-3 rounded-2xl border border-emerald-500 bg-emerald-500 px-4 text-left text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                <Printer className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span><strong className="block">{t("invoice.large")}</strong><span className="mt-0.5 block text-xs text-emerald-50">{t("invoice.largeHint")}</span></span>
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function todayInputValue() {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
