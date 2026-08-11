"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import NextImage, { type ImageProps } from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Columns3, ImageIcon, Search, SlidersHorizontal } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { useAppSettings } from "./AppSettingsProvider";
import type { InventoryItem } from "@/lib/types";
import {
  filterInventoryItems,
  inventoryStatusOptions,
  paginateInventoryItems,
  visibleItemStatus,
  type VisibleItemStatus,
} from "@/lib/inventory-list";
import { addSearchHistoryEntry, parseSearchHistory } from "@/lib/search-history";
import {
  DEFAULT_INVENTORY_COLUMNS,
  INVENTORY_COLUMN_KEYS,
  parseInventoryColumnVisibility,
  type InventoryColumnKey,
} from "@/lib/inventory-columns";
import InventoryExportButton from "@/components/InventoryExportButton";
import TmcBulkActions from "@/components/TmcBulkActions";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type { UserRole } from "@/lib/contracts/users";

function loadSearchHistory(storageKey: string) {
  try {
    return parseSearchHistory(window.localStorage.getItem(storageKey));
  } catch {
    return [];
  }
}

function saveSearchHistory(storageKey: string, history: string[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(history));
  } catch {
    // Private browsing and embedded webviews may deny local storage.
  }
}

function loadColumnVisibility(storageKey: string) {
  try {
    return parseInventoryColumnVisibility(window.localStorage.getItem(storageKey));
  } catch {
    return { ...DEFAULT_INVENTORY_COLUMNS };
  }
}

function saveColumnVisibility(
  storageKey: string,
  visibility: typeof DEFAULT_INVENTORY_COLUMNS,
) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(visibility));
  } catch {
    // Private browsing and embedded webviews may deny local storage.
  }
}

// Item photos are private API resources. Rendering them directly preserves the
// user's session cookie and avoids sending a versioned URL through the image
// optimizer, which intentionally rejects unrestricted query strings.
function Image(props: ImageProps) {
  return <NextImage {...props} unoptimized />;
}

function Thumb({ color, photo }: { color: string; photo?: string }) {
  const { t } = useAppSettings();
  return (
    <div
      className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg"
      style={{ backgroundColor: `${color}12`, border: `1px solid ${color}35` }}
    >
      {photo ? <Image src={photo} alt={t("items.photoAlt")} fill sizes="64px" className="object-cover" /> : <ImageIcon className="h-5 w-5 text-zinc-400" aria-label={t("items.photoMissing")} />}
      <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-bl-lg bg-emerald-500 px-1 text-[10px] font-semibold text-white">
        1
      </span>
    </div>
  );
}

function DisplayStatus({ value }: { value: string }) {
  const { dataLabel } = useAppSettings();
  const styles =
    value === "Не распределено"
      ? "bg-zinc-100 text-zinc-500"
      : value === "Маркировано"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-violet-100 text-violet-600";

  return <span className={`rounded px-2 py-1 text-xs font-medium ${styles}`}>{dataLabel(value)}</span>;
}

function itemDetails(item: InventoryItem) {
  const words = item.name.split(" ");
  const type = words[0] || item.category;
  const model = words.slice(1).join(" ") || "—";

  return { type, model };
}

function VisibleStatus({ status }: { status: VisibleItemStatus }) {
  return status.kind === "display" ? (
    <DisplayStatus value={status.value} />
  ) : (
    <StatusBadge status={status.value} />
  );
}

function itemLinkLabel(item: InventoryItem) {
  const identifier = item.inventoryNumber !== "-" ? item.inventoryNumber : `ID ${item.id}`;
  return `${item.name} — ${identifier}`;
}

function FilterInput({
  label,
  value,
  onChange,
  historyStorageKey,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  historyStorageKey?: string;
}) {
  const { t } = useAppSettings();
  const [history, setHistory] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  const blurTimeoutRef = useRef<number | null>(null);
  const visibleHistory = useMemo(() => {
    const query = value.trim().toLocaleLowerCase();
    return query
      ? history.filter((entry) => entry.toLocaleLowerCase().includes(query))
      : history;
  }, [history, value]);

  useEffect(() => {
    if (!historyStorageKey) return;
    const timeout = window.setTimeout(
      () => setHistory(loadSearchHistory(historyStorageKey)),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [historyStorageKey]);

  useEffect(() => () => {
    if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current);
  }, []);

  function rememberValue() {
    const nextValue = value.trim();
    if (!nextValue || !historyStorageKey) return;
    setHistory((current) => {
      const next = addSearchHistoryEntry(current, nextValue);
      saveSearchHistory(historyStorageKey, next);
      return next;
    });
  }

  function selectValue(entry: string) {
    onChange(entry);
    setFocused(false);
    setHistory((current) => {
      const next = addSearchHistoryEntry(current, entry);
      if (historyStorageKey) saveSearchHistory(historyStorageKey, next);
      return next;
    });
  }

  return (
    <div
      className="relative text-sm text-zinc-600"
      onFocus={() => {
        if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current);
        setFocused(true);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        rememberValue();
        blurTimeoutRef.current = window.setTimeout(() => setFocused(false), 0);
      }}
    >
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-zinc-500">{label}</label>
      <input
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") rememberValue();
          if (event.key === "Escape") setFocused(false);
        }}
        className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 outline-none focus:border-accent"
      />
      {focused && visibleHistory.length ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg">
          <div className="px-3 py-2 text-xs text-zinc-500">{t("items.recentSearches")}</div>
          <ul className="border-t border-black/5 py-1">
            {visibleHistory.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  onClick={() => selectValue(entry)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  <Search className="h-3.5 w-3.5 text-zinc-400" /> {entry}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const EMPTY_TABLE_FILTERS = {
  category: "all",
  location: "all",
  statusKey: "all",
  brand: "",
  model: "",
  itemType: "",
  building: "",
  responsible: "",
};

const COLUMN_LABEL_KEYS = {
  photo: "items.photo",
  qrCode: "items.qrCode",
  itemType: "items.type",
  brandModel: "items.brandModel",
  location: "items.location",
  status: "items.status",
  responsible: "items.responsible",
  additionalInfo: "items.additionalInfo",
  updatedAt: "items.updated",
  createdAt: "items.createdAt",
  quantity: "items.quantity",
  price: "items.price",
} as const;

export default function ItemsTable({
  items,
  showFilters = true,
  dateLabel,
  searchHistoryScope,
  columnSettingsScope,
  excelDataset,
  headerActions,
  bulkActions,
}: {
  items: InventoryItem[];
  showFilters?: boolean;
  dateLabel?: string;
  searchHistoryScope?: string;
  columnSettingsScope?: string;
  excelDataset?: "items" | "decommissioned";
  headerActions?: React.ReactNode;
  bulkActions?: {
    actorUserId: string;
    actorRole: UserRole;
    buildings: BuildingDto[];
    rooms: RoomDto[];
    variant?: "transfer" | "issue";
  };
}) {
  const { t, dataLabel } = useAppSettings();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [filters, setFilters] = useState(EMPTY_TABLE_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_TABLE_FILTERS);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_INVENTORY_COLUMNS);
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const columnSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const searchFocusTimeoutRef = useRef<number | null>(null);
  const pageSize = 10;
  const searchHistoryStorageKey = searchHistoryScope
    ? `yu-inventory:item-search-history:v1:${searchHistoryScope}`
    : null;
  const columnSettingsStorageKey = columnSettingsScope
    ? `yu-inventory:item-columns:v1:${columnSettingsScope}`
    : null;
  const filterHistoryStorageKey = searchHistoryScope
    ? `yu-inventory:item-filter-history:v1:${searchHistoryScope}`
    : null;

  useEffect(() => {
    if (!searchHistoryStorageKey) return;
    const timeout = window.setTimeout(
      () => setSearchHistory(loadSearchHistory(searchHistoryStorageKey)),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [searchHistoryStorageKey]);

  useEffect(() => {
    if (!columnSettingsStorageKey) return;
    const timeout = window.setTimeout(
      () => setVisibleColumns(loadColumnVisibility(columnSettingsStorageKey)),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [columnSettingsStorageKey]);

  useEffect(() => () => {
    if (searchFocusTimeoutRef.current) window.clearTimeout(searchFocusTimeoutRef.current);
  }, []);

  useEffect(() => {
    const value = query.trim();
    if (!value || !searchHistoryStorageKey) return;
    const timeout = window.setTimeout(() => {
      setSearchHistory((current) => {
        const next = addSearchHistoryEntry(current, value);
        saveSearchHistory(searchHistoryStorageKey, next);
        return next;
      });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [query, searchHistoryStorageKey]);

  const statusOptions = useMemo(() => inventoryStatusOptions(items), [items]);
  const visibleSearchHistory = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return searchHistory;
    return searchHistory.filter((entry) =>
      entry.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [query, searchHistory]);

  const filtered = useMemo(() => {
    return filterInventoryItems(items, {
      query,
      ...filters,
    });
  }, [items, query, filters]);

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value !== "" && value !== "all" && key !== "category",
  ).length;

  const pagination = paginateInventoryItems(filtered, page, pageSize);
  const visibleColumnCount = Object.values(visibleColumns).filter(Boolean).length;
  const {
    page: currentPage,
    pageCount,
    pageItems,
    from: firstRecord,
    to: lastRecord,
  } = pagination;

  const allVisibleSelected =
    pageItems.length > 0 && pageItems.every((item) => selected.has(item.id));
  const someVisibleSelected = pageItems.some((item) => selected.has(item.id));
  const selectedItems = items.filter((item) => selected.has(item.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  function toggleItem(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectSearchQuery(value: string) {
    setQuery(value);
    setPage(1);
    setSearchFocused(false);
    setSearchHistory((current) => {
      const next = addSearchHistoryEntry(current, value);
      if (searchHistoryStorageKey) saveSearchHistory(searchHistoryStorageKey, next);
      return next;
    });
  }

  function rememberCurrentSearch() {
    const value = query.trim();
    if (!value || !searchHistoryStorageKey) return;
    setSearchHistory((current) => {
      const next = addSearchHistoryEntry(current, value);
      saveSearchHistory(searchHistoryStorageKey, next);
      return next;
    });
  }

  function clearSearchHistory() {
    setSearchHistory([]);
    if (!searchHistoryStorageKey) return;
    try {
      window.localStorage.removeItem(searchHistoryStorageKey);
    } catch {
      // Private browsing and embedded webviews may deny local storage.
    }
  }

  function updateDraftFilter(name: keyof typeof EMPTY_TABLE_FILTERS, value: string) {
    setDraftFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters() {
    setFilters(draftFilters);
    setPage(1);
    setFilterPanelOpen(false);
    filterButtonRef.current?.focus();
  }

  function clearFilters() {
    setDraftFilters(EMPTY_TABLE_FILTERS);
    setFilters(EMPTY_TABLE_FILTERS);
    setPage(1);
  }

  function toggleColumn(key: InventoryColumnKey) {
    setVisibleColumns((current) => {
      const next = { ...current, [key]: !current[key] };
      if (columnSettingsStorageKey) saveColumnVisibility(columnSettingsStorageKey, next);
      return next;
    });
  }

  function resetColumns() {
    const next = { ...DEFAULT_INVENTORY_COLUMNS };
    setVisibleColumns(next);
    if (columnSettingsStorageKey) saveColumnVisibility(columnSettingsStorageKey, next);
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) pageItems.forEach((item) => next.delete(item.id));
      else pageItems.forEach((item) => next.add(item.id));
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {bulkActions && selectedItems.length > 0 ? (
        <TmcBulkActions
          items={selectedItems}
          actorUserId={bulkActions.actorUserId}
          actorRole={bulkActions.actorRole}
          buildings={bulkActions.buildings}
          rooms={bulkActions.rooms}
          variant={bulkActions.variant}
          onComplete={() => router.refresh()}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      {excelDataset || headerActions ? (
        <div className="flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-start">
          {excelDataset ? (
            <InventoryExportButton
              dataset={excelDataset}
              itemIds={filtered.map((item) => item.id)}
              columns={visibleColumns}
            />
          ) : null}
          {headerActions}
        </div>
      ) : null}
      {showFilters ? (
      <div className="rounded-2xl border border-black/5 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div
          className="relative min-w-[260px] flex-1"
          onFocus={() => {
            if (searchFocusTimeoutRef.current) window.clearTimeout(searchFocusTimeoutRef.current);
            setSearchFocused(true);
          }}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            searchFocusTimeoutRef.current = window.setTimeout(() => setSearchFocused(false), 0);
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchFocused(false);
              if (event.key === "Enter") {
                rememberCurrentSearch();
                setSearchFocused(false);
              }
            }}
            onClick={() => setSearchFocused(true)}
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            className="w-full rounded-xl border border-black/10 bg-zinc-50 py-2.5 pl-9 pr-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 md:text-sm"
          />
          {searchFocused && visibleSearchHistory.length ? (
            <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg">
              <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-zinc-500">
                <span>{t("items.recentSearches")}</span>
                <button type="button" onClick={clearSearchHistory} className="rounded text-emerald-700 hover:underline">{t("items.clearRecentSearches")}</button>
              </div>
              <ul className="border-t border-black/5 py-1">
                {visibleSearchHistory.map((entry) => (
                  <li key={entry}>
                    <button type="button" onClick={() => selectSearchQuery(entry)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50">
                      <Search className="h-3.5 w-3.5 text-zinc-400" /> {entry}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          </div>
          <button
            ref={filterButtonRef}
            type="button"
            aria-expanded={filterPanelOpen}
            aria-controls="inventory-advanced-filters"
            onClick={() => {
              if (!filterPanelOpen) setDraftFilters(filters);
              setFilterPanelOpen((value) => !value);
            }}
            className="hidden min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-zinc-50 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 md:inline-flex"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t("items.filters")}
            {activeFilterCount ? <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs text-white">{activeFilterCount}</span> : null}
          </button>
          <div
            className="relative hidden md:block"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setColumnSettingsOpen(false);
              }
            }}
          >
            <button
              ref={columnSettingsButtonRef}
              type="button"
              aria-expanded={columnSettingsOpen}
              aria-controls="inventory-column-settings"
              onClick={() => setColumnSettingsOpen((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setColumnSettingsOpen(false);
              }}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-black/10 bg-zinc-50 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
            >
              <Columns3 className="h-4 w-4" /> {t("items.columnSettings")}
            </button>
            {columnSettingsOpen ? (
              <div
                id="inventory-column-settings"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setColumnSettingsOpen(false);
                    columnSettingsButtonRef.current?.focus();
                  }
                }}
                className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-black/10 bg-white p-3 shadow-xl"
              >
                <div className="space-y-1">
                  {INVENTORY_COLUMN_KEYS.map((key) => (
                    <label key={key} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
                      <input type="checkbox" checked={visibleColumns[key]} onChange={() => toggleColumn(key)} className="h-4 w-4 accent-emerald-500" />
                      {t(COLUMN_LABEL_KEYS[key])}
                    </label>
                  ))}
                </div>
                <button type="button" onClick={resetColumns} className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50">{t("items.resetColumns")}</button>
              </div>
            ) : null}
          </div>
        </div>
        {filterPanelOpen ? (
          <div id="inventory-advanced-filters" className="mt-4 border-t border-black/5 pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FilterInput label={t("itemDetails.brand")} value={draftFilters.brand} onChange={(value) => updateDraftFilter("brand", value)} historyStorageKey={filterHistoryStorageKey ? `${filterHistoryStorageKey}:brand` : undefined} />
              <FilterInput label={t("itemDetails.model")} value={draftFilters.model} onChange={(value) => updateDraftFilter("model", value)} historyStorageKey={filterHistoryStorageKey ? `${filterHistoryStorageKey}:model` : undefined} />
              <FilterInput label={t("items.type")} value={draftFilters.itemType} onChange={(value) => updateDraftFilter("itemType", value)} historyStorageKey={filterHistoryStorageKey ? `${filterHistoryStorageKey}:item-type` : undefined} />
              <FilterInput label={t("items.filterBuilding")} value={draftFilters.building} onChange={(value) => updateDraftFilter("building", value)} historyStorageKey={filterHistoryStorageKey ? `${filterHistoryStorageKey}:building` : undefined} />
              <FilterInput label={t("items.filterRoom")} value={draftFilters.location === "all" ? "" : draftFilters.location} onChange={(value) => updateDraftFilter("location", value || "all")} historyStorageKey={filterHistoryStorageKey ? `${filterHistoryStorageKey}:location` : undefined} />
              <label className="text-sm text-zinc-600">
                <span className="mb-1 block text-xs font-medium text-zinc-500">{t("items.status")}</span>
                <select value={draftFilters.statusKey} onChange={(event) => updateDraftFilter("statusKey", event.target.value)} className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 outline-none focus:border-accent">
                  <option value="all">{t("items.allStatuses")}</option>
                  {statusOptions.map((option) => <option key={option.key} value={option.key}>{option.kind === "display" ? dataLabel(option.value) : t(`status.${option.value}`)}</option>)}
                </select>
              </label>
              <FilterInput label={t("items.responsible")} value={draftFilters.responsible} onChange={(value) => updateDraftFilter("responsible", value)} historyStorageKey={filterHistoryStorageKey ? `${filterHistoryStorageKey}:responsible` : undefined} />
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={clearFilters} className="rounded-xl border border-black/10 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50">{t("items.clearFilters")}</button>
              <button type="button" onClick={applyFilters} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600">{t("items.applyFilters")}</button>
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

      <div className="flex items-center justify-between text-sm text-zinc-400">
        <p>{t("items.found", { count: filtered.length })}</p>
        {selected.size > 0 && <p>{t("items.selected", { count: selected.size })}</p>}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-black/5 bg-white md:block">
        <table className="min-w-[1380px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-zinc-400">
              <th className="w-16 px-2 py-2 text-center"><label className="inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-xl hover:bg-zinc-50"><input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-checked={someVisibleSelected && !allVisibleSelected ? "mixed" : allVisibleSelected} aria-label={t("items.selectAll")} className="h-6 w-6 cursor-pointer accent-emerald-600" /></label></th>
              {visibleColumns.photo ? <th className="px-3 py-4 font-medium">{t("items.photo")}</th> : null}
              {visibleColumns.qrCode ? <th className="px-3 py-4 font-medium">{t("items.qrCode")}</th> : null}
              {visibleColumns.itemType ? <th className="px-3 py-4 font-medium">{t("items.type")}</th> : null}
              {visibleColumns.brandModel ? <th className="px-3 py-4 font-medium">{t("items.brandModel")}</th> : null}
              {visibleColumns.location ? <th className="px-3 py-4 font-medium">{t("items.location")}</th> : null}
              {visibleColumns.status ? <th className="px-3 py-4 font-medium">{t("items.status")}</th> : null}
              {visibleColumns.responsible ? <th className="px-3 py-4 font-medium">{t("items.responsible")}</th> : null}
              {visibleColumns.additionalInfo ? <th className="px-3 py-4 font-medium">{t("items.additionalInfo")}</th> : null}
              {visibleColumns.updatedAt ? <th className="px-3 py-4 font-medium">{dateLabel ?? t("items.updated")}</th> : null}
              {visibleColumns.createdAt ? <th className="px-3 py-4 font-medium">{t("items.createdAt")}</th> : null}
              {visibleColumns.quantity ? <th className="px-3 py-4 text-center font-medium">{t("items.quantity")}</th> : null}
              {visibleColumns.price ? <th className="px-4 py-4 text-right font-medium">{t("items.price")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((item) => {
              const details = itemDetails(item);
              return (
                <tr
                  key={item.id}
                  onClick={() => router.push(`/items/${item.id}`)}
                  className={`border-b border-black/5 last:border-0 hover:bg-zinc-50/80 cursor-pointer`}
                >
                  <td className="px-2 py-2 text-center" onClick={(event) => event.stopPropagation()}><label className="inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-xl hover:bg-zinc-50"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} aria-label={t("items.selectOne", { name: item.name })} className="h-6 w-6 cursor-pointer accent-emerald-600" /></label></td>
                  {visibleColumns.photo ? <td className="px-3 py-4"><Thumb color={item.photoColor} photo={item.photo} /></td> : null}
                  {visibleColumns.qrCode ? <td className="px-3 py-4 text-zinc-500">{item.qrCode ?? item.inventoryNumber}</td> : null}
                  {visibleColumns.itemType ? <td className="px-3 py-4"><p className="font-medium text-zinc-800">{dataLabel(item.itemType ?? details.type)}</p><p className="mt-1 text-zinc-500">{t("common.electronics")}</p></td> : null}
                  {visibleColumns.brandModel ? <td className="max-w-[220px] px-3 py-4 font-medium text-zinc-800"><Link href={`/items/${item.id}`} aria-label={itemLinkLabel(item)} onClick={(event) => event.stopPropagation()} className="rounded-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{item.brandModel ?? details.model}</Link></td> : null}
                  {visibleColumns.location ? <td className="max-w-[190px] px-3 py-4 text-zinc-600">{item.location}</td> : null}
                  {visibleColumns.status ? <td className="px-3 py-4"><VisibleStatus status={visibleItemStatus(item)} /></td> : null}
                  {visibleColumns.responsible ? <td className="px-3 py-4 text-zinc-600">{item.responsible}</td> : null}
                  {visibleColumns.additionalInfo ? <td className="max-w-[240px] px-3 py-4 text-zinc-600">{item.additionalInfo ?? "—"}</td> : null}
                  {visibleColumns.updatedAt ? <td className="whitespace-nowrap px-3 py-4 text-zinc-600">{item.updatedAt ?? "—"}</td> : null}
                  {visibleColumns.createdAt ? <td className="whitespace-nowrap px-3 py-4 text-zinc-600">{item.createdAt ?? "—"}</td> : null}
                  {visibleColumns.quantity ? <td className="px-3 py-4 text-center text-zinc-700">{item.quantity ?? 1}</td> : null}
                  {visibleColumns.price ? <td className="whitespace-nowrap px-4 py-4 text-right font-semibold text-zinc-800">{(item.price ?? 0).toFixed(2)}<br /><span className="text-xs">{t("common.currency")}</span></td> : null}
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={visibleColumnCount + 1} className="px-4 py-10 text-center text-zinc-400">{t("items.empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><span>{t("items.recordsPerPage")}</span><span className="rounded-lg border border-black/10 px-3 py-1.5 font-medium">10</span></div>
        <div className="flex items-center gap-3">
          <span>{t("items.range", { from: firstRecord, to: lastRecord, total: filtered.length })}</span>
          <button aria-label={t("common.previous")} type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="rounded-lg border border-black/10 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">‹</button>
          <button aria-label={t("common.next")} type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount} className="rounded-lg border border-black/10 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40">›</button>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {pageItems.map((item) => {
          const details = itemDetails(item);
          return (
            <article key={item.id} onClick={() => router.push(`/items/${item.id}`)} className="cursor-pointer rounded-2xl border border-black/5 bg-white p-4">
              <div className="flex items-start gap-3">
                <label onClick={(event) => event.stopPropagation()} className="-ml-2 -mt-2 inline-flex min-h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl active:bg-zinc-100">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} aria-label={t("items.selectOne", { name: item.name })} className="h-6 w-6 cursor-pointer accent-emerald-600" />
                </label>
                {visibleColumns.photo ? <Thumb color={item.photoColor} photo={item.photo} /> : null}
                <div className="min-w-0 flex-1">
                  {visibleColumns.brandModel ? <p className="font-medium text-zinc-800"><Link href={`/items/${item.id}`} aria-label={itemLinkLabel(item)} onClick={(event) => event.stopPropagation()} className="rounded-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{item.brandModel ?? details.model}</Link></p> : null}
                  {visibleColumns.itemType ? <p className="mt-1 text-xs text-zinc-500">{dataLabel(item.itemType ?? details.type)} · {t("common.electronics")}</p> : null}
                  {visibleColumns.qrCode ? <p className="mt-1 text-xs text-zinc-400">{item.qrCode ?? item.inventoryNumber}</p> : null}
                  {visibleColumns.additionalInfo ? <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.additionalInfo ?? "—"}</p> : null}
                </div>
                {visibleColumns.status ? <VisibleStatus status={visibleItemStatus(item)} /> : null}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-zinc-600">
                {visibleColumns.location ? <><dt className="text-zinc-400">{t("items.location")}</dt><dd className="text-right">{item.location}</dd></> : null}
                {visibleColumns.responsible ? <><dt className="text-zinc-400">{t("items.responsible")}</dt><dd className="text-right">{item.responsible}</dd></> : null}
                {visibleColumns.updatedAt ? <><dt className="text-zinc-400">{dateLabel ?? t("items.updated")}</dt><dd className="text-right">{item.updatedAt ?? "—"}</dd></> : null}
                {visibleColumns.createdAt ? <><dt className="text-zinc-400">{t("items.createdAt")}</dt><dd className="text-right">{item.createdAt ?? "—"}</dd></> : null}
                {visibleColumns.quantity ? <><dt className="text-zinc-400">{t("items.quantity")}</dt><dd className="text-right">{item.quantity ?? 1}</dd></> : null}
                {visibleColumns.price ? <><dt className="text-zinc-400">{t("items.price")}</dt><dd className="text-right">{(item.price ?? 0).toFixed(2)} {t("common.currency")}</dd></> : null}
              </dl>
            </article>
          );
        })}
        {filtered.length === 0 && <p className="rounded-2xl border border-black/5 bg-white p-8 text-center text-zinc-400">{t("items.empty")}</p>}
      </div>
    </div>
  );
}
