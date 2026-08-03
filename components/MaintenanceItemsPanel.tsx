"use client";

import { useState } from "react";
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";

type NextStatus = "active" | "decommissioned";

export default function MaintenanceItemsPanel({
  initialItems,
  canManage,
}: {
  initialItems: InventoryItemDto[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(item: InventoryItemDto, status: NextStatus) {
    setBusy(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: item.version,
          roomId: item.room.id,
          inventoryNumber: item.inventoryNumber,
          status,
        }),
      });
      const body = (await response.json()) as {
        item?: InventoryItemDto;
        error?: string;
      };
      if (!response.ok || !body.item) {
        throw new Error(body.error ?? "update_failed");
      }
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch {
      setError("Не удалось обновить статус. Обновите страницу и повторите попытку.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-800">ТМЦ на обслуживании</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Все предметы, ожидающие ремонта или решения о списании.
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
          ТМЦ на обслуживании нет.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-black/5 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-3">ТМЦ</th>
                <th className="px-3 py-3">Корпус / помещение</th>
                <th className="px-3 py-3">Ответственный</th>
                <th className="px-3 py-3">Переведено</th>
                {canManage ? <th className="px-3 py-3">Действия</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3">
                    <div className="font-medium text-zinc-800">{item.name}</div>
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
                    {item.responsible?.name || "Не назначен"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-zinc-600">
                    {new Date(item.updatedAt).toLocaleString()}
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
                          Вернуть в «Активен»
                        </button>
                        <button
                          type="button"
                          disabled={busy === item.id}
                          onClick={() => void changeStatus(item, "decommissioned")}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          Списать
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
