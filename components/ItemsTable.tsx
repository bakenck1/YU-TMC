"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NextImage, { type ImageProps } from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageIcon, Search } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { useAppSettings } from "./AppSettingsProvider";
import type { InventoryItem } from "@/lib/types";
import {
  filterInventoryItems,
  paginateInventoryItems,
  visibleItemStatus,
  type VisibleItemStatus,
} from "@/lib/inventory-list";

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
      {photo ? <Image src={photo} alt={t("items.photoAlt")} fill sizes="64px" className="object-cover" /> : <ImageIcon className="h-5 w-5 text-zinc-400" aria-label="Фото не добавлено" />}
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

export default function ItemsTable({
  items,
  showFilters = true,
  dateLabel,
}: {
  items: InventoryItem[];
  showFilters?: boolean;
  dateLabel?: string;
}) {
  const { t, dataLabel } = useAppSettings();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [statusKey, setStatusKey] = useState("all");
  const [location, setLocation] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const pageSize = 10;

  const categories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category))),
    [items],
  );
  const locations = useMemo(
    () => Array.from(new Set(items.map((item) => item.location))),
    [items],
  );
  const statusOptions = useMemo(() => {
    const values = new Map<string, VisibleItemStatus>();
    items.forEach((item) => {
      const status = visibleItemStatus(item);
      values.set(status.key, status);
    });
    return [...values.values()];
  }, [items]);

  const filtered = useMemo(() => {
    return filterInventoryItems(items, {
      query,
      category,
      location,
      statusKey,
    });
  }, [items, query, category, statusKey, location]);

  const pagination = paginateInventoryItems(filtered, page, pageSize);
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
      {showFilters ? (
      <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 lg:flex-row lg:items-center">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            className="w-full rounded-xl border border-black/10 bg-zinc-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <select aria-label={t("items.allCategories")} value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm outline-none focus:border-accent">
          <option value="all">{t("items.allCategories")}</option>
          {categories.map((value) => <option key={value} value={value}>{dataLabel(value)}</option>)}
        </select>
        <select aria-label={t("items.allStatuses")} value={statusKey} onChange={(event) => { setStatusKey(event.target.value); setPage(1); }} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm outline-none focus:border-accent">
          <option value="all">{t("items.allStatuses")}</option>
          {statusOptions.map((option) => <option key={option.key} value={option.key}>{option.kind === "display" ? dataLabel(option.value) : t(`status.${option.value}`)}</option>)}
        </select>
        <select aria-label={t("items.allLocations")} value={location} onChange={(event) => { setLocation(event.target.value); setPage(1); }} className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5 text-sm outline-none focus:border-accent">
          <option value="all">{t("items.allLocations")}</option>
          {locations.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
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
              <th className="w-14 px-4 py-4 text-center"><input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-checked={someVisibleSelected && !allVisibleSelected ? "mixed" : allVisibleSelected} aria-label={t("items.selectAll")} className="h-4 w-4 accent-emerald-500" /></th>
              <th className="px-3 py-4 font-medium">{t("items.photo")}</th>
              <th className="px-3 py-4 font-medium">{t("items.qrCode")}</th>
              <th className="px-3 py-4 font-medium">{t("items.type")}</th>
              <th className="px-3 py-4 font-medium">{t("items.brandModel")}</th>
              <th className="px-3 py-4 font-medium">{t("items.location")}</th>
              <th className="px-3 py-4 font-medium">{t("items.status")}</th>
              <th className="px-3 py-4 font-medium">{t("items.responsible")}</th>
              <th className="px-3 py-4 font-medium">{dateLabel ?? t("items.updated")}</th>
              <th className="px-3 py-4 text-center font-medium">{t("items.quantity")}</th>
              <th className="px-4 py-4 text-right font-medium">{t("items.price")}</th>
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
                  <td className="px-4 py-4 text-center" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} aria-label={t("items.selectOne", { name: item.name })} className="h-4 w-4 accent-emerald-500" /></td>
                  <td className="px-3 py-4"><Thumb color={item.photoColor} photo={item.photo} /></td>
                  <td className="px-3 py-4 text-zinc-500">{item.qrCode ?? item.inventoryNumber}</td>
                  <td className="px-3 py-4"><p className="font-medium text-zinc-800">{dataLabel(item.itemType ?? details.type)}</p><p className="mt-1 text-zinc-500">{t("common.electronics")}</p></td>
                  <td className="max-w-[220px] px-3 py-4 font-medium text-zinc-800"><Link href={`/items/${item.id}`} aria-label={itemLinkLabel(item)} onClick={(event) => event.stopPropagation()} className="rounded-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{item.brandModel ?? details.model}</Link></td>
                  <td className="max-w-[190px] px-3 py-4 text-zinc-600">{item.location}</td>
                  <td className="px-3 py-4"><VisibleStatus status={visibleItemStatus(item)} /></td>
                  <td className="px-3 py-4 text-zinc-600">{item.responsible}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-zinc-600">{item.updatedAt ?? "—"}</td>
                  <td className="px-3 py-4 text-center text-zinc-700">{item.quantity ?? 1}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-right font-semibold text-zinc-800">{(item.price ?? 0).toFixed(2)}<br /><span className="text-xs">{t("common.currency")}</span></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-zinc-400">{t("items.empty")}</td></tr>}
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
                <input type="checkbox" checked={selected.has(item.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleItem(item.id)} aria-label={t("items.selectOne", { name: item.name })} className="mt-1 h-4 w-4 accent-emerald-500" />
                <Thumb color={item.photoColor} photo={item.photo} />
                <div className="min-w-0 flex-1"><p className="font-medium text-zinc-800"><Link href={`/items/${item.id}`} aria-label={itemLinkLabel(item)} onClick={(event) => event.stopPropagation()} className="rounded-sm hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{item.brandModel ?? details.model}</Link></p><p className="mt-1 text-xs text-zinc-500">{dataLabel(item.itemType ?? details.type)} · {t("common.electronics")}</p><p className="mt-1 text-xs text-zinc-400">{item.qrCode ?? item.inventoryNumber}</p></div>
                <VisibleStatus status={visibleItemStatus(item)} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-zinc-600">
                <dt className="text-zinc-400">{t("items.location")}</dt><dd className="text-right">{item.location}</dd>
                <dt className="text-zinc-400">{t("items.responsible")}</dt><dd className="text-right">{item.responsible}</dd>
                <dt className="text-zinc-400">{dateLabel ?? t("items.updated")}</dt><dd className="text-right">{item.updatedAt ?? "—"}</dd>
                <dt className="text-zinc-400">{t("items.quantityPrice")}</dt><dd className="text-right">{item.quantity ?? 1} · {(item.price ?? 0).toFixed(2)} {t("common.currency")}</dd>
              </dl>
            </article>
          );
        })}
        {filtered.length === 0 && <p className="rounded-2xl border border-black/5 bg-white p-8 text-center text-zinc-400">{t("items.empty")}</p>}
      </div>
    </div>
  );
}
