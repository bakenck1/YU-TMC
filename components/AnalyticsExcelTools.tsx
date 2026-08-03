"use client";

import { FileSpreadsheet } from "lucide-react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryExcelTools from "@/components/InventoryExcelTools";

export default function AnalyticsExcelTools({
  canBulkManage,
}: {
  canBulkManage: boolean;
}) {
  const { t } = useAppSettings();

  if (!canBulkManage) return null;

  return (
    <section aria-labelledby="analytics-excel-tools-title" className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 id="analytics-excel-tools-title" className="font-semibold text-zinc-900">
            {t("excel.title")}
          </h2>
        </div>
      </div>

      {canBulkManage ? (
        <div className="mt-4">
          <InventoryExcelTools summaryLabel="excel.importFile" />
        </div>
      ) : null}
    </section>
  );
}
