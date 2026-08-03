"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { InventoryColumnVisibility } from "@/lib/inventory-columns";
import { createInventoryExportPayload } from "@/lib/inventory-export";

type InventoryExportButtonProps = {
  dataset: "items" | "decommissioned";
  itemIds: string[];
  columns: InventoryColumnVisibility;
};

export default function InventoryExportButton({
  dataset,
  itemIds,
  columns,
}: InventoryExportButtonProps) {
  const { t } = useAppSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function exportItems() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/excel?action=export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          createInventoryExportPayload(dataset, itemIds, columns),
        ),
      });
      if (!response.ok) throw new Error("export_failed");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = dataset === "items" ? "inventory-items.xlsx" : "decommissioned-items.xlsx";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError(t("excel.requestFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <button type="button" onClick={() => void exportItems()} disabled={busy} aria-busy={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-50 sm:w-auto">
        <Download className="h-4 w-4" />
        {busy ? t("excel.exporting") : t("excel.exportItems")}
      </button>
      {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}
