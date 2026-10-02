"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Banknote,
  Boxes,
  ChevronDown,
  Wrench,
  X,
} from "lucide-react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import StatusBadge from "@/components/StatusBadge";
import type { TranslationKey } from "@/lib/i18n";
import {
  inventoryLineValue,
  itemsForInventorySummary,
  summarizeInventory,
  type InventorySummaryKind,
} from "@/lib/inventory-summary";
import type { InventoryItem } from "@/lib/types";
import {
  canonicalInventoryDetailsReturnHref,
  inventoryDetailsHref,
} from "@/lib/inventory-list-state";

interface SummaryCard {
  kind: InventorySummaryKind;
  title: TranslationKey;
  hint: TranslationKey;
  icon: ComponentType<{ className?: string }>;
  color: string;
  iconClass: string;
}

const CARDS: readonly SummaryCard[] = [
  {
    kind: "totalValue",
    title: "items.summaryTotalValue",
    hint: "items.summaryValueHint",
    icon: Banknote,
    color: "border-emerald-200 bg-emerald-50/70 text-emerald-800",
    iconClass: "bg-emerald-100 text-emerald-700",
  },
  {
    kind: "totalItems",
    title: "items.summaryTotalItems",
    hint: "items.summaryTotalHint",
    icon: Boxes,
    color: "border-blue-200 bg-blue-50/70 text-blue-800",
    iconClass: "bg-blue-100 text-blue-700",
  },
  {
    kind: "maintenance",
    title: "items.summaryMaintenance",
    hint: "items.summaryMaintenanceHint",
    icon: Wrench,
    color: "border-amber-200 bg-amber-50/70 text-amber-800",
    iconClass: "bg-amber-100 text-amber-700",
  },
  {
    kind: "decommissioned",
    title: "items.summaryDecommissioned",
    hint: "items.summaryDecommissionedHint",
    icon: Archive,
    color: "border-red-200 bg-red-50/70 text-red-800",
    iconClass: "bg-red-100 text-red-700",
  },
];

export default function InventorySummaryAccordions({
  items,
}: {
  items: InventoryItem[];
}) {
  const { locale, t } = useAppSettings();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openKind, setOpenKind] = useState<InventorySummaryKind | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const summary = useMemo(() => summarizeInventory(items), [items]);
  const openItems = useMemo(
    () => (openKind ? itemsForInventorySummary(items, openKind) : []),
    [items, openKind],
  );
  const openCard = CARDS.find((card) => card.kind === openKind);
  const number = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const listSearch = searchParams.toString();
  const returnHref =
    canonicalInventoryDetailsReturnHref(
      `${pathname}${listSearch ? `?${listSearch}` : ""}`,
    ) ?? "/items";

  useEffect(() => {
    if (!openKind) return;
    panelRef.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [openKind]);

  function cardValue(kind: InventorySummaryKind) {
    if (kind === "totalValue") {
      return `${number.format(summary.totalValue)} ${t("common.currency")}`;
    }
    return `${number.format(summary[kind])} ${t("common.unitShort")}`;
  }

  function itemHref(item: InventoryItem) {
    const itemPath = item.localGroupId
      ? `/local-barcodes/${item.localGroupId}`
      : `/items/${item.id}`;
    return inventoryDetailsHref(itemPath, returnHref);
  }

  const panel = openKind && openCard ? (
    <section
      ref={panelRef}
      id={`inventory-summary-${openKind}-panel`}
      role="region"
      aria-labelledby={`inventory-summary-${openKind}-title`}
      className={`col-span-full min-w-0 scroll-mb-24 scroll-mt-4 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm ${CARDS.findIndex((card) => card.kind === openKind) < 2 ? "sm:order-1" : "sm:order-3"} xl:order-1`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-2">
        <h2 id={`inventory-summary-${openKind}-title`} className="font-semibold text-zinc-900">
          {t(openCard.title)}
        </h2>
        <span className="ml-auto text-sm text-zinc-500">
          {t("items.found", { count: openItems.length })}
        </span>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => {
            document.getElementById(`inventory-summary-${openKind}-button`)?.focus();
            setOpenKind(null);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="max-h-[55dvh] overflow-auto overscroll-contain">
        <table className="w-full text-left text-sm sm:min-w-[760px]">
          <thead className="sticky top-0 hidden bg-zinc-50 text-xs uppercase tracking-wide text-zinc-400 sm:table-header-group">
            <tr>
              <th className="px-4 py-3 font-medium">{t("items.name")}</th>
              <th className="px-4 py-3 font-medium">
                {t("items.inventoryNumber")}
              </th>
              <th className="px-4 py-3 font-medium">
                {t("items.location")}
              </th>
              <th className="px-4 py-3 font-medium">
                {t("items.status")}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {t("items.quantity")}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {t("items.summaryLineTotal")}
              </th>
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {openItems.map((item) => (
              <tr
                key={item.id}
                onClick={() => router.push(itemHref(item))}
                className="grid cursor-pointer grid-cols-2 gap-x-3 gap-y-2 border-t border-black/5 p-4 transition-colors first:border-t-0 hover:bg-zinc-50/80 sm:table-row sm:p-0"
              >
                <td className="col-span-2 min-w-0 font-medium text-zinc-800 sm:px-4 sm:py-3">
                  <Link
                    href={itemHref(item)}
                    onClick={(event) => event.stopPropagation()}
                    className="flex min-h-11 items-center break-words hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className="col-span-2 break-all text-zinc-600 sm:px-4 sm:py-3">
                  <span className="mr-2 text-xs text-zinc-400 sm:hidden">{t("items.inventoryNumber")}</span>
                  {item.inventoryNumber}
                </td>
                <td className="col-span-2 break-words text-zinc-600 sm:px-4 sm:py-3">
                  {item.location}
                </td>
                <td className="min-w-0 sm:px-4 sm:py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="self-center text-right text-zinc-600 sm:px-4 sm:py-3">
                  <span className="mr-2 text-xs text-zinc-400 sm:hidden">{t("items.quantity")}</span>
                  {number.format(item.quantity ?? 1)}
                </td>
                <td className="col-span-2 text-right font-semibold text-zinc-800 sm:px-4 sm:py-3">
                  <span className="mr-2 text-xs font-normal text-zinc-400 sm:hidden">{t("items.summaryLineTotal")}</span>
                  {number.format(inventoryLineValue(item))}{" "}
                  {t("common.currency")}
                </td>
              </tr>
            ))}
            {openItems.length === 0 ? (
              <tr className="block sm:table-row">
                <td
                  colSpan={6}
                  className="block px-4 py-8 text-center text-zinc-400 sm:table-cell"
                >
                  {t("items.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  ) : null;

  return (
    <section aria-label={t("items.summaryAria")}>
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((card, index) => {
          const Icon = card.icon;
          const expanded = openKind === card.kind;
          return (
            <Fragment key={card.kind}>
              <button
                id={`inventory-summary-${card.kind}-button`}
                type="button"
                aria-expanded={expanded}
                aria-controls={`inventory-summary-${card.kind}-panel`}
                onClick={() =>
                  setOpenKind((current) => current === card.kind ? null : card.kind)
                }
                className={`group h-full min-w-0 rounded-2xl border p-4 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${index < 2 ? "sm:order-0" : "sm:order-2"} xl:order-0 ${card.color}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`rounded-xl p-2.5 ${card.iconClass}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`mt-1 h-5 w-5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                  />
                </div>
                <p className="mt-4 text-sm font-medium">{t(card.title)}</p>
                <p className="mt-1 break-words text-2xl font-bold tracking-tight">
                  {cardValue(card.kind)}
                </p>
                <p className="mt-2 text-xs opacity-75">{t(card.hint)}</p>
              </button>
              {expanded ? panel : null}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
