"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import StatusBadge from "./StatusBadge";
import type { InventoryItem, ItemStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: ItemStatus | "all"; label: string }[] = [
  { value: "all", label: "Все статусы" },
  { value: "active", label: "Активен" },
  { value: "maintenance", label: "На обслуживании" },
  { value: "decommissioned", label: "Списано" },
];

function Thumb({ color }: { color: string }) {
  return (
    <div
      className="h-10 w-10 shrink-0 rounded-lg"
      style={{ backgroundColor: `${color}1a`, border: `1px solid ${color}40` }}
    />
  );
}

export default function ItemsTable({ items }: { items: InventoryItem[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<ItemStatus | "all">("all");
  const [location, setLocation] = useState("all");

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))),
    [items],
  );
  const locations = useMemo(
    () => Array.from(new Set(items.map((i) => i.location))),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.inventoryNumber.toLowerCase().includes(q);
      const matchesCategory = category === "all" || item.category === category;
      const matchesStatus = status === "all" || item.status === status;
      const matchesLocation = location === "all" || item.location === location;
      return matchesQuery && matchesCategory && matchesStatus && matchesLocation;
    });
  }, [items, query, category, status, location]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию или инв. номеру"
            className="w-full rounded-xl border border-black/10 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="all">Все категории</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ItemStatus | "all")}
          className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="all">Все локации</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-zinc-400">Найдено: {filtered.length}</p>

      <div className="hidden overflow-hidden rounded-2xl border border-black/5 bg-white md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-zinc-400">
              <th className="px-4 py-3 font-medium">Фото</th>
              <th className="px-4 py-3 font-medium">Название</th>
              <th className="px-4 py-3 font-medium">Инв. номер</th>
              <th className="px-4 py-3 font-medium">Категория</th>
              <th className="px-4 py-3 font-medium">Локация</th>
              <th className="px-4 py-3 font-medium">Ответственный</th>
              <th className="px-4 py-3 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-black/5 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <Thumb color={item.photoColor} />
                </td>
                <td className="px-4 py-3 font-medium text-zinc-800">{item.name}</td>
                <td className="px-4 py-3 text-zinc-500">{item.inventoryNumber}</td>
                <td className="px-4 py-3 text-zinc-500">{item.category}</td>
                <td className="px-4 py-3 text-zinc-500">{item.location}</td>
                <td className="px-4 py-3 text-zinc-500">{item.responsible}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-400">
                  Ничего не найдено
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {filtered.map((item) => (
          <div key={item.id} className="rounded-2xl border border-black/5 bg-white p-4">
            <div className="flex items-start gap-3">
              <Thumb color={item.photoColor} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-800">{item.name}</p>
                <p className="text-xs text-zinc-400">{item.inventoryNumber}</p>
              </div>
              <StatusBadge status={item.status} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-500">
              <dt className="text-zinc-400">Категория</dt>
              <dd className="text-right">{item.category}</dd>
              <dt className="text-zinc-400">Локация</dt>
              <dd className="text-right">{item.location}</dd>
              <dt className="text-zinc-400">Ответственный</dt>
              <dd className="text-right">{item.responsible}</dd>
            </dl>
          </div>
        ))}
        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-black/5 bg-white p-8 text-center text-zinc-400">
            Ничего не найдено
          </p>
        ) : null}
      </div>
    </div>
  );
}
