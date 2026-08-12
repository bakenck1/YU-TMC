"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Banknote, Boxes, Camera, UserCheck } from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import AnalyticsChartCard from "./AnalyticsChartCard";
import AnalyticsPercentRing from "./AnalyticsPercentRing";
import AnalyticsSummaryCard from "./AnalyticsSummaryCard";
import AnalyticsDetailsDialog from "./AnalyticsDetailsDialog";
import AnalyticsDonutChart from "./AnalyticsDonutChart";
import { filteredDashboard, type AnalyticsDashboardData } from "@/lib/analytics-dashboard";
import type { AnalyticsChartSelection } from "@/lib/analytics-chart-selection";
import { formatAnalyticsMoney } from "@/lib/analytics-formatters";

export default function AnalyticsCharts({
  data: initialData,
}: {
  data: AnalyticsDashboardData;
}) {
  const { locale, t } = useAppSettings();
  const [building, setBuilding] = useState("all");
  const [itemType, setItemType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const data = useMemo(() => filteredDashboard(initialData, { building, itemType, dateFrom, dateTo }), [building, dateFrom, dateTo, initialData, itemType]);
  const buildings = useMemo(() => Array.from(new Set(initialData.records.map((record) => record.building))).sort(), [initialData.records]);
  const itemTypes = useMemo(() => Array.from(new Set(initialData.records.map((record) => record.itemType))).sort(), [initialData.records]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [selection, setSelection] = useState<AnalyticsChartSelection | null>(null);
  const assignedPercent = data.summary.totalItems
    ? (data.summary.assigned / data.summary.totalItems) * 100
    : 0;
  const photoPercent = data.summary.totalItems
    ? (data.summary.withPhoto / data.summary.totalItems) * 100
    : 0;

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-slate-700 p-6 text-white shadow-lg md:p-8">
        <div className="absolute -bottom-20 right-32 h-52 w-52 rounded-full bg-slate-600/70" />
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[28px] border-emerald-400/10" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Banknote className="h-6 w-6 text-emerald-300" />
            </span>
            <div>
              <p className="text-sm text-slate-300">{t("analytics.totalValueTitle")}</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
                {formatAnalyticsMoney(data.summary.totalValue, locale)}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                {t("analytics.description", { count: numberFormatter.format(data.summary.totalItems) })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <AnalyticsPercentRing value={data.summary.completion} />
            <div>
              <p className="text-sm font-medium">{t("analytics.databaseCompletion")}</p>
              <p className="mt-1 text-xs text-slate-300">
                {t("analytics.recordsProgress", { current: data.summary.totalItems, target: data.summary.targetItems })}
              </p>
              <Link
                href="/items"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-400/50 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-400/10"
              >
                {t("analytics.viewItems")} <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section aria-label={t("analytics.filters")} className="grid gap-3 rounded-2xl border border-black/5 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
        <select value={building} onChange={(event) => setBuilding(event.target.value)} aria-label={t("analytics.buildingFilter")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm"><option value="all">{t("analytics.allBuildings")}</option>{buildings.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={itemType} onChange={(event) => setItemType(event.target.value)} aria-label={t("analytics.itemTypeFilter")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm"><option value="all">{t("analytics.allItemTypes")}</option>{itemTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} aria-label={t("analytics.dateFrom")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm" />
        <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} aria-label={t("analytics.dateTo")} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm" />
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AnalyticsSummaryCard
          label={t("analytics.totalItems")}
          value={numberFormatter.format(data.summary.totalItems)}
          hint={t("analytics.plannedDatabase", { count: numberFormatter.format(data.summary.targetItems) })}
          progress={data.summary.completion}
          icon={Boxes}
        />
        <AnalyticsSummaryCard
          label={t("analytics.assigned")}
          value={`${assignedPercent.toFixed(1)}%`}
          hint={t("analytics.completedRecords", { count: data.summary.assigned })}
          progress={assignedPercent}
          icon={UserCheck}
        />
        <AnalyticsSummaryCard
          label={t("analytics.hasPhoto")}
          value={`${photoPercent.toFixed(1)}%`}
          hint={t("analytics.photosInDatabase", { count: data.summary.withPhoto })}
          progress={photoPercent}
          icon={Camera}
        />
        <AnalyticsSummaryCard
          label={t("analytics.distributedObjects")}
          value={numberFormatter.format(data.objects.length)}
          hint={t("analytics.locationsInDatabase", { count: data.locations.length })}
          progress={Math.min(100, data.objects.length * 20)}
          icon={Boxes}
        />
      </div>

      <div className="grid gap-5 min-[1700px]:grid-cols-2">
        <AnalyticsChartCard title={t("analytics.brands")} subtitle={t("analytics.brandsSubtitle")}>
          <AnalyticsDonutChart
            data={data.brands}
            title={t("analytics.brands")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </AnalyticsChartCard>
        <AnalyticsChartCard title={t("analytics.types")} subtitle={t("analytics.typesSubtitle")}>
          <AnalyticsDonutChart
            data={data.types}
            title={t("analytics.types")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </AnalyticsChartCard>
        <AnalyticsChartCard title={t("analytics.statuses")} subtitle={t("analytics.statusesSubtitle")}>
          <AnalyticsDonutChart
            data={data.statuses}
            title={t("analytics.statuses")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
            statusColors
          />
        </AnalyticsChartCard>
        <AnalyticsChartCard title={t("analytics.locations")} subtitle={t("analytics.locationsSubtitle")}>
          <AnalyticsDonutChart
            data={data.locations}
            title={t("analytics.locations")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </AnalyticsChartCard>
        <AnalyticsChartCard
          title={t("analytics.valueByType")}
          subtitle={t("analytics.valueByTypeSubtitle")}
        >
          <AnalyticsDonutChart
            data={data.valueByType}
            title={t("analytics.valueByType")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
            valueKind="money"
          />
        </AnalyticsChartCard>
        <AnalyticsChartCard title={t("analytics.responsiblePeople")} subtitle={t("analytics.responsibleSubtitle")}>
          <AnalyticsDonutChart
            data={data.responsibles}
            title={t("analytics.responsiblePeople")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </AnalyticsChartCard>
        <AnalyticsChartCard title={t("analytics.objects")} subtitle={t("analytics.objectsSubtitle")}>
          <AnalyticsDonutChart
            data={data.objects}
            title={t("analytics.objects")}
            centerTotal={data.summary.totalItems}
            onSelect={setSelection}
          />
        </AnalyticsChartCard>
      </div>

      {selection ? (
        <AnalyticsDetailsDialog selection={selection} onClose={() => setSelection(null)} />
      ) : null}
    </div>
  );
}
