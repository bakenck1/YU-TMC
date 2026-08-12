"use client";

import { Banknote, PackageSearch, Users, X } from "lucide-react";

import AnalyticsDetailMetric from "@/components/AnalyticsDetailMetric";
import AnalyticsDetailTable from "@/components/AnalyticsDetailTable";
import { useAppSettings } from "@/components/AppSettingsProvider";
import Dialog from "@/components/Dialog";
import IconButton from "@/components/IconButton";
import type { AnalyticsChartSelection, AnalyticsChartTone } from "@/lib/analytics-chart-selection";
import { formatAnalyticsMoney } from "@/lib/analytics-formatters";

const TONE_MARKERS: Record<AnalyticsChartTone, string> = {
  green: "bg-[#16a34a]",
  sky: "bg-[#0ea5e9]",
  violet: "bg-[#7c3aed]",
  amber: "bg-[#f59e0b]",
  rose: "bg-[#e11d48]",
  cyan: "bg-[#0891b2]",
  lime: "bg-[#65a30d]",
  ochre: "bg-[#a16207]",
  neutral: "bg-[#a1a1aa]",
};

interface AnalyticsDetailsDialogProps {
  selection: AnalyticsChartSelection;
  onClose: () => void;
}

export default function AnalyticsDetailsDialog({ selection, onClose }: AnalyticsDetailsDialogProps) {
  const { dataLabel, locale, t } = useAppSettings();
  const totalQuantity = selection.segment.records.reduce((sum, record) => sum + record.quantity, 0);
  const totalPrice = selection.segment.records.reduce((sum, record) => sum + record.price, 0);
  const responsibleCount = new Set(
    selection.segment.records
      .map((record) => record.responsible)
      .filter((responsible) => responsible && responsible !== "-"),
  ).size;

  return (
    <Dialog labelledBy="analytics-details-title" onDismiss={onClose} size="2xl" layer="critical" scrollable={false}>
      <div className="flex max-h-[90vh] flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-5 sm:px-7">
          <div className="flex min-w-0 items-start gap-4">
            <span className={`mt-1 h-12 w-3 shrink-0 rounded-full ${TONE_MARKERS[selection.tone]}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm text-zinc-400">{selection.title}</p>
              <h2 id="analytics-details-title" className="truncate text-2xl font-bold text-zinc-900">
                {dataLabel(selection.segment.name)}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">{t("analytics.detailsSubtitle")}</p>
            </div>
          </div>
          <IconButton label={t("common.close")} icon={X} onClick={onClose} />
        </div>

        <div className="grid gap-3 border-b border-zinc-100 bg-zinc-50/70 p-5 sm:grid-cols-3 sm:px-7">
          <AnalyticsDetailMetric icon={PackageSearch} label={t("items.quantity")} value={`${totalQuantity} ${t("common.piecesShort")}`} />
          <AnalyticsDetailMetric icon={Users} label={t("analytics.responsibles")} value={String(responsibleCount)} />
          <AnalyticsDetailMetric icon={Banknote} label={t("analytics.totalCost")} value={formatAnalyticsMoney(totalPrice, locale)} />
        </div>

        <AnalyticsDetailTable records={selection.segment.records} />
      </div>
    </Dialog>
  );
}
