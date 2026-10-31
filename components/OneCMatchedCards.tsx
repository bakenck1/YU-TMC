"use client";

import Link from "next/link";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { useOneCRegistry } from "@/lib/use-one-c-registry";
import type { OneCMatchedCard } from "@/lib/one-c-matched-cards";

const copy = {
  ru: { title: "Найденные карточки", assets: "Основные средства", materials: "Материальный предмет", owner: "Ответственный", name: "Наименование", number: "Инвентарный номер", code: "Код 1С", current: "Цена в нашей базе", price: "Цена 1С", source: "Источник", find: "Найти", search: "Поиск найденной карточки", placeholder: "Название, номер, код 1С или ответственный", loading: "Загрузка…", error: "Не удалось загрузить список", none: "Ничего не найдено", previous: "Назад", next: "Далее" },
  kk: { title: "Табылған карточкалар", assets: "НҚ", materials: "Материалдық заттар", owner: "Жауапты тұлға", name: "Атауы", number: "Түгендеу нөмірі", code: "1С коды", current: "Біздің базадағы баға", price: "1С бағасы", source: "Дереккөз", find: "Іздеу", search: "Табылған карточканы іздеу", placeholder: "Атауы, нөмірі, 1С коды немесе жауапты тұлға", loading: "Жүктелуде…", error: "Тізім жүктелмеді", none: "Ештеңе табылмады", previous: "Артқа", next: "Келесі" },
  en: { title: "Matched cards", assets: "Fixed assets", materials: "Materials", owner: "Responsible person", name: "Name", number: "Inventory number", code: "1C code", current: "Current price", price: "1C price", source: "Source", find: "Search", search: "Search matched cards", placeholder: "Name, number, 1C code or owner", loading: "Loading…", error: "Could not load the list", none: "No results", previous: "Previous", next: "Next" },
} as const;

export default function OneCMatchedCards({ group, revision }: { group: "materials" | "assets"; revision: string }) {
  const { language, locale } = useAppSettings();
  const c = copy[language];
  const { page, search, setSearch, appliedSearch, busy, error, load } = useOneCRegistry<OneCMatchedCard>(`/api/integrations/1c/analytics/matched?group=${group}`, revision);
  const money = (value: string | null) => value === null ? "—" : Number(value).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section aria-label={`${c.title}: ${c[group]}`} className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-5" aria-busy={busy}>
    <h2 className="text-lg font-semibold">{c[group]} · {page?.total.toLocaleString(locale) ?? "—"}</h2>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void load(1, search); }}>
      <input aria-label={c.search} placeholder={c.placeholder} value={search} onChange={event => setSearch(event.target.value)} maxLength={255} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" />
      <button disabled={busy} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50">{c.find}</button>
    </form>
    {error ? <p role="alert">{c.error}</p> : null}
    {page ? <><div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50"><tr>{[c.owner, c.price, c.current, c.name, c.code, c.number, c.source].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
      <tbody>{page.data.map(card => <tr key={card.id} className="border-t align-top"><td className="p-3">{card.responsibleName ?? "—"}</td><td className="p-3 font-semibold text-emerald-700">{money(card.oneCUnitPrice)}</td><td className="p-3">{money(card.currentUnitPrice)}</td><td className="p-3"><Link href={`/items/${encodeURIComponent(card.id)}`} className="text-blue-700 hover:underline">{card.name}</Link></td><td className="p-3 font-mono">{card.oneCCode ?? card.sourceCodes.join(", ")}</td><td className="p-3">{card.inventoryNumber}</td><td className="p-3">{card.source}</td></tr>)}{!page.data.length ? <tr><td colSpan={7} className="p-5 text-center">{c.none}</td></tr> : null}</tbody></table></div>
      <div className="flex items-center gap-3"><button disabled={busy || page.page <= 1 || search !== appliedSearch} onClick={() => void load(page.page - 1, appliedSearch)} className="rounded border px-3 py-1 disabled:opacity-40">{c.previous}</button><span>{page.page} / {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><button disabled={busy || page.page * page.pageSize >= page.total || search !== appliedSearch} onClick={() => void load(page.page + 1, appliedSearch)} className="rounded border px-3 py-1 disabled:opacity-40">{c.next}</button></div></> : busy ? <p role="status">{c.loading}</p> : null}
  </section>;
}
