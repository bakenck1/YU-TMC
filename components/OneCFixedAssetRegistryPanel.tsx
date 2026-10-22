"use client";

import { useState } from "react";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { useOneCRegistry } from "@/lib/use-one-c-registry";
import { useAppSettings } from "@/components/AppSettingsProvider";

const copy = {
  ru: { title: "Основные средства", active: "На учёте", all: "Все статусы", status: "Статус 1С", priceNote: "Если первоначальная стоимость пуста, 1С её не передала. Остаточная стоимость не заменяет цену карточки.", search: "Поиск основных средств", placeholder: "Название, код, номер, штрихкод или ответственный", loading: "Загрузка…", find: "Найти", total: "Записей", changed: " · Нажмите «Найти», чтобы применить поиск", columns: ["Наименование / код", "Инвентарный номер / штрихкод", "Количество", "Первоначальная стоимость, KZT", "Остаточная стоимость, KZT", "Подразделение", "Ответственный"], unspecified: "Не указан", none: "Ничего не найдено", empty: "Нет основных средств на учёте", emptyAll: "Нет основных средств", previous: "Назад", page: "Страница", of: "из", next: "Далее", loadingList: "Загрузка списка…", error: "Не удалось загрузить список. Повторите попытку." },
  kk: { title: "Негізгі құралдар", active: "Есепте", all: "Барлық мәртебе", status: "1С мәртебесі", priceNote: "Бастапқы құн бос болса, 1С оны жібермеген. Қалдық құны карточка бағасын алмастырмайды.", search: "Негізгі құралдарды іздеу", placeholder: "Атауы, коды, нөмірі, штрихкоды немесе жауаптысы", loading: "Жүктелуде…", find: "Іздеу", total: "Жазба", changed: " · Іздеуді қолдану үшін «Іздеу» түймесін басыңыз", columns: ["Атауы / коды", "Түгендеу нөмірі / штрихкод", "Саны", "Бастапқы құны, KZT", "Қалдық құны, KZT", "Бөлімше", "Жауапты тұлға"], unspecified: "Көрсетілмеген", none: "Ештеңе табылмады", empty: "Есепте негізгі құрал жоқ", emptyAll: "Негізгі құралдар жоқ", previous: "Артқа", page: "Бет", of: "/", next: "Келесі", loadingList: "Тізім жүктелуде…", error: "Тізім жүктелмеді. Қайталап көріңіз." },
  en: { title: "Fixed assets", active: "On the books", all: "All statuses", status: "1C status", priceNote: "A blank initial cost means 1C did not send it. Residual cost cannot replace an item's price.", search: "Search fixed assets", placeholder: "Name, code, number, barcode or responsible person", loading: "Loading…", find: "Search", total: "Records", changed: " · Select Search to apply the query", columns: ["Name / code", "Inventory number / barcode", "Quantity", "Initial cost, KZT", "Residual cost, KZT", "Department", "Responsible person"], unspecified: "Not specified", none: "No results", empty: "No fixed assets on the books", emptyAll: "No fixed assets", previous: "Previous", page: "Page", of: "of", next: "Next", loadingList: "Loading list…", error: "Could not load the list. Try again." },
} as const;

export default function OneCFixedAssetRegistryPanel({ revision }: { revision?: string | null }) {
  const { language, locale } = useAppSettings();
  const c = copy[language];
  const [scope, setScope] = useState<"active" | "all">("active");
  const { page, search, setSearch, appliedSearch, busy, error, load } = useOneCRegistry<{ external_id: string; payload: OneCFixedAsset }>(`/api/integrations/1c/assets/registry?scope=${scope}`, revision);
  const money = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  return <section aria-label={c.title} aria-busy={busy} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{c.title}</h2><div className="flex gap-1 rounded-lg bg-slate-100 p-1">{(["active", "all"] as const).map(value => <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)} className={`rounded-md px-3 py-1.5 text-sm ${scope === value ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600"}`}>{value === "active" ? c.active : c.all}</button>)}</div></div>
    <p className="text-xs text-slate-500">{c.priceNote}</p>
    <form onSubmit={event => { event.preventDefault(); void load(1, search); }} className="flex flex-wrap gap-2">
      <input aria-label={c.search} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder={c.placeholder} value={search} onChange={event => setSearch(event.target.value)} maxLength={255} />
      <button disabled={busy} className="rounded-xl bg-[#002060] px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? c.loading : c.find}</button>
    </form>
    {error ? <p role="alert" className="text-sm text-red-700">{c.error}</p> : null}
    {page ? <>
      <p role="status" className="text-sm text-slate-600">{c.total}: <strong>{page.total.toLocaleString(locale)}</strong>{search !== appliedSearch ? c.changed : ""}</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{c.columns.map(label => <th key={label} className="p-3">{label}</th>)}{scope === "all" ? <th className="p-3">{c.status}</th> : null}</tr></thead>
        <tbody>{page.data.map(({ external_id, payload: a }) => <tr key={external_id} className="border-t border-slate-100 align-top hover:bg-slate-50">
          <td className="p-3">{a.name}<div className="mt-1 font-mono text-slate-500">{a.code ?? "—"}</div></td>
          <td className="p-3"><div>{a.inventoryNumber ?? "—"}</div><div className="mt-1 text-slate-500">{a.barcode ?? "—"}</div></td><td className="p-3">{a.quantity}</td>
          <td className="p-3">{money(a.initialCost)}</td><td className="p-3">{money(a.residualCost)}</td><td className="p-3">{a.location ?? "—"}</td><td className="p-3">{a.responsibleName ?? c.unspecified}</td>{scope === "all" ? <td className="p-3">{a.status}</td> : null}
        </tr>)}{page.data.length === 0 ? <tr><td colSpan={scope === "all" ? 8 : 7} className="p-6 text-center text-slate-500">{appliedSearch ? c.none : scope === "all" ? c.emptyAll : c.empty}</td></tr> : null}</tbody></table></div>
      <div className="flex items-center gap-3"><button type="button" disabled={busy || page.page <= 1 || search !== appliedSearch} onClick={() => void load(page.page - 1, appliedSearch)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">{c.previous}</button><span className="text-xs text-slate-500">{c.page} {page.page} {c.of} {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><button type="button" disabled={busy || page.page * page.pageSize >= page.total || search !== appliedSearch} onClick={() => void load(page.page + 1, appliedSearch)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">{c.next}</button></div>
    </> : busy ? <p role="status" className="text-sm text-slate-500">{c.loadingList}</p> : null}
  </section>;
}
