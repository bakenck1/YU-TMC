"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Search, Trash2 } from "lucide-react";

import ItemsTable from "@/components/ItemsTable";
import { useAppSettings } from "@/components/AppSettingsProvider";
import {
  filterDecommissionedItems,
  hasActiveDecommissionedFilters,
  inventoryItemBuilding,
} from "@/lib/decommissioned-items";
import type { InventoryItem } from "@/lib/types";

export default function DecommissionedItemsView({
  items,
  canExport,
}: {
  items: InventoryItem[];
  canExport: boolean;
}) {
  const { t } = useAppSettings();
  const [query, setQuery] = useState("");
  const [building, setBuilding] = useState("all");
  const [responsible, setResponsible] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const buildings = useMemo(
    () =>
      Array.from(new Set(items.map(inventoryItemBuilding))).sort((left, right) =>
        left.localeCompare(right),
      ),
    [items],
  );
  const responsibles = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.responsible).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right)),
    [items],
  );
  const filtered = useMemo(() => {
    return filterDecommissionedItems(items, {
      query,
      building,
      responsible,
      dateFrom,
      dateTo,
    });
  }, [building, dateFrom, dateTo, items, query, responsible]);
  const inUse = filtered.filter((item) => item.status === "decommissioned_in_use");
  const archived = filtered.filter((item) => item.status === "decommissioned");
  const completeDataset = !hasActiveDecommissionedFilters({
    query, building, responsible, dateFrom, dateTo,
  });

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-red-50 p-2 text-red-600">
            <Trash2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">
              {t("decommissioned.title")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {t("decommissioned.subtitle", { count: items.length })}
            </p>
          </div>
        </div>
      </section>

      <section
        aria-label={t("decommissioned.filters")}
        className="grid gap-3 rounded-2xl border border-black/5 bg-white p-4 md:grid-cols-2 xl:grid-cols-5"
      >
        <label className="relative md:col-span-2 xl:col-span-1">
          <span className="sr-only">{t("common.search")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("common.search")}
            className="w-full rounded-xl border border-black/10 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <select
          aria-label={t("decommissioned.allBuildings")}
          value={building}
          onChange={(event) => setBuilding(event.target.value)}
          className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm"
        >
          <option value="all">{t("decommissioned.allBuildings")}</option>
          {buildings.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label={t("decommissioned.allResponsibles")}
          value={responsible}
          onChange={(event) => setResponsible(event.target.value)}
          className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm"
        >
          <option value="all">{t("decommissioned.allResponsibles")}</option>
          {responsibles.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <label className="relative">
          <span className="sr-only">{t("decommissioned.dateFrom")}</span>
          <CalendarRange className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="date"
            aria-label={t("decommissioned.dateFrom")}
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
            className="w-full rounded-xl border border-black/10 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm"
          />
        </label>
        <label className="relative">
          <span className="sr-only">{t("decommissioned.dateTo")}</span>
          <CalendarRange className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="date"
            aria-label={t("decommissioned.dateTo")}
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
            className="w-full rounded-xl border border-black/10 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
        <h2 className="text-lg font-semibold text-orange-900">
          {t("decommissioned.inUseTitle")} ({inUse.length})
        </h2>
        <p className="mt-1 text-sm text-orange-800">{t("decommissioned.inUseSubtitle")}</p>
      </section>
      <ItemsTable
        items={inUse}
        showFilters={false}
        itemReturnHref="/items/decommissioned"
        dateLabel={t("decommissioned.decommissionedAt")}
        excelDataset={canExport ? "decommissioned_in_use" : undefined}
        completeDataset={completeDataset}
      />

      <h2 className="pt-2 text-lg font-semibold text-zinc-800">
        {t("decommissioned.archiveTitle")} ({archived.length})
      </h2>
      <ItemsTable
        items={archived}
        showFilters={false}
        itemReturnHref="/items/decommissioned"
        dateLabel={t("decommissioned.decommissionedAt")}
        excelDataset={canExport ? "decommissioned" : undefined}
        completeDataset={completeDataset}
      />
    </div>
  );
}
