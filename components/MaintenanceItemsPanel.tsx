"use client";

import { useState } from "react";
import Link from "next/link";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import { useAppSettings } from "@/components/AppSettingsProvider";
import {
  resolveMaintenanceItemWithRefresh,
  type MaintenanceResolutionStatus,
} from "@/lib/maintenance-resolution-client";

export default function MaintenanceItemsPanel({
  initialItems,
  canManage,
}: {
  initialItems: InventoryItemDto[];
  canManage: boolean;
}) {
  const { locale, t } = useAppSettings();
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(
    item: InventoryItemDto,
    status: MaintenanceResolutionStatus,
  ) {
    setBusy(item.id);
    setError(null);
    try {
      await resolveMaintenanceItemWithRefresh(fetch, item, status);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch {
      setError(t("maintenance.error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="maintenance-items-title" className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="maintenance-items-title" className="text-lg font-semibold text-zinc-800">{t("maintenance.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("maintenance.description")}
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
          {items.length}
        </span>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-amber-200 bg-white p-6 text-center text-sm text-zinc-500">
          {t("maintenance.empty")}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-black/5 bg-white">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">{t("maintenance.tableCaption")}</caption>
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="px-3 py-3">{t("maintenance.item")}</th>
                <th scope="col" className="px-3 py-3">{t("maintenance.location")}</th>
                <th scope="col" className="px-3 py-3">{t("maintenance.responsible")}</th>
                <th scope="col" className="px-3 py-3">{t("maintenance.startedAt")}</th>
                {canManage ? <th scope="col" className="px-3 py-3">{t("maintenance.actions")}</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3">
                    <Link href={`/items/${item.id}`} className="font-medium text-emerald-700 hover:underline">{item.name}</Link>
                    <div className="text-xs text-zinc-500">
                      {item.inventoryNumber}
                      {item.brand || item.model
                        ? ` · ${[item.brand, item.model].filter(Boolean).join(" / ")}`
                        : ""}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-zinc-700">
                    {item.room.buildingName}
                    <div className="text-xs text-zinc-500">{item.room.designation}</div>
                  </td>
                  <td className="px-3 py-3 text-zinc-700">
                    {item.responsible?.name || t("common.notAssigned")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-zinc-600">
                    {new Date(item.maintenanceStartedAt ?? item.updatedAt).toLocaleString(locale)}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() => void changeStatus(item, "active")}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {t("maintenance.returnActive")}
                        </button>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() => void changeStatus(item, "decommissioned")}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          {t("maintenance.writeOff")}
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
