"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Banknote,
  Boxes,
  ChevronDown,
  Wrench,
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
  const [openKind, setOpenKind] = useState<InventorySummaryKind | null>(null);
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

  function cardValue(kind: InventorySummaryKind) {
    if (kind === "totalValue") {
      return `${number.format(summary.totalValue)} ${t("common.currency")}`;
    }
    return `${number.format(summary[kind])} ${t("common.unitShort")}`;
  }

  return (
    <section aria-label={t("items.summaryAria")} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const expanded = openKind === card.kind;
          return (
            <button
              key={card.kind}
              id={`inventory-summary-${card.kind}-button`}
              type="button"
              aria-expanded={expanded}
              aria-controls={`inventory-summary-${card.kind}-panel`}
              onClick={() =>
                setOpenKind((current) =>
                  current === card.kind ? null : card.kind,
                )
              }
              className={`group rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${card.color}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={`rounded-xl p-2.5 ${card.iconClass}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <ChevronDown
                  className={`mt-1 h-5 w-5 transition-transform duration-200 ${
                    expanded ? "rotate-180" : ""
                  }`}
                />
              </div>
              <p className="mt-4 text-sm font-medium">{t(card.title)}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight">
                {cardValue(card.kind)}
              </p>
              <p className="mt-2 text-xs opacity-75">{t(card.hint)}</p>
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false} mode="wait">
        {openKind && openCard ? (
          <motion.section
            key={openKind}
            id={`inventory-summary-${openKind}-panel`}
            role="region"
            aria-labelledby={`inventory-summary-${openKind}-button`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between gap-4 border-b border-black/5 px-4 py-3">
              <h2 className="font-semibold text-zinc-900">
                {t(openCard.title)}
              </h2>
              <span className="text-sm text-zinc-500">
                {t("items.found", { count: openItems.length })}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-400">
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
                <tbody>
                  {openItems.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => router.push(`/items/${item.id}`)}
                      className="cursor-pointer border-t border-black/5 transition-colors first:border-t-0 hover:bg-zinc-50/80"
                    >
                      <td className="px-4 py-3 font-medium text-zinc-800">
                        <Link
                          href={`/items/${item.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {item.inventoryNumber}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {item.location}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-600">
                        {number.format(item.quantity ?? 1)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-800">
                        {number.format(inventoryLineValue(item))}{" "}
                        {t("common.currency")}
                      </td>
                    </tr>
                  ))}
                  {openItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-zinc-400"
                      >
                        {t("items.empty")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
