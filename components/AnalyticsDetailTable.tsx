"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { AnalyticsRecord } from "@/lib/analytics-dashboard";
import { formatAnalyticsMoney } from "@/lib/analytics-formatters";

interface AnalyticsDetailTableProps {
  records: AnalyticsRecord[];
}

export default function AnalyticsDetailTable({ records }: AnalyticsDetailTableProps) {
  const { dataLabel, locale, t } = useAppSettings();

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[920px] border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e4e4e7]">
          <tr className="text-xs uppercase tracking-wide text-zinc-400">
            <th className="px-6 py-4 font-medium">{t("items.responsible")}</th>
            <th className="px-4 py-4 font-medium">{t("analytics.whatTaken")}</th>
            <th className="px-4 py-4 font-medium">{t("items.qrCode")}</th>
            <th className="px-4 py-4 font-medium">{t("items.location")}</th>
            <th className="px-4 py-4 text-center font-medium">{t("items.quantity")}</th>
            <th className="px-4 py-4 text-right font-medium">{t("analytics.cost")}</th>
            <th className="px-5 py-4"><span className="sr-only">{t("analytics.viewItems")}</span></th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className="border-b border-zinc-100 hover:bg-emerald-50/40">
              <td className="px-6 py-4 font-medium text-zinc-800">
                {record.responsible && record.responsible !== "-" ? record.responsible : t("status.unassigned")}
              </td>
              <td className="px-4 py-4">
                <p className="font-medium text-zinc-800">{dataLabel(record.itemType || record.name)}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{record.brandModel || t("analytics.modelMissing")}</p>
              </td>
              <td className="px-4 py-4 text-zinc-600">{record.qrCode || "—"}</td>
              <td className="px-4 py-4 text-zinc-600">{record.location}</td>
              <td className="px-4 py-4 text-center font-semibold text-zinc-800">{record.quantity}</td>
              <td className="px-4 py-4 text-right font-semibold text-zinc-800">{formatAnalyticsMoney(record.price, locale)}</td>
              <td className="px-5 py-4 text-right">
                <Link
                  href={`/items/${record.id}`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-100"
                  aria-label={t("analytics.openItem", { name: dataLabel(record.itemType || record.name) })}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
