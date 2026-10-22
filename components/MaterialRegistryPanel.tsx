"use client";

import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import type { MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";
import { useOneCRegistry } from "@/lib/use-one-c-registry";
import { useAppSettings } from "@/components/AppSettingsProvider";

const copy = {
  ru: { title: "Материальный предмет", active: "Только с положительным остатком", search: "Поиск материального предмета", placeholder: "Название, код, номер, штрихкод или ответственный", loading: "Загрузка…", find: "Найти", total: "Строк остатков", changed: " · Нажмите «Найти», чтобы применить поиск", columns: ["Наименование / код", "Счёт", "Количество / ед.", "Учётная цена, KZT", "Склад", "Ответственный"], inventory: "Инв. №", barcode: "Штрихкод", unspecified: "Не указан", none: "Ничего не найдено", empty: "Нет материальных предметов с положительным остатком", previous: "Назад", page: "Страница", of: "из", next: "Далее", loadingList: "Загрузка списка…", error: "Не удалось загрузить список. Повторите попытку." },
  kk: { title: "Материалдық заттар", active: "Тек оң қалдығы барлар", search: "Материалдық заттарды іздеу", placeholder: "Атауы, коды, нөмірі, штрихкоды немесе жауаптысы", loading: "Жүктелуде…", find: "Іздеу", total: "Қалдық жолдары", changed: " · Іздеуді қолдану үшін «Іздеу» түймесін басыңыз", columns: ["Атауы / коды", "Шот", "Саны / өлшемі", "Есептік бағасы, KZT", "Қойма", "Жауапты тұлға"], inventory: "Түг. №", barcode: "Штрихкод", unspecified: "Көрсетілмеген", none: "Ештеңе табылмады", empty: "Оң қалдығы бар материалдық заттар жоқ", previous: "Артқа", page: "Бет", of: "/", next: "Келесі", loadingList: "Тізім жүктелуде…", error: "Тізім жүктелмеді. Қайталап көріңіз." },
  en: { title: "Materials", active: "Positive balance only", search: "Search materials", placeholder: "Name, code, number, barcode or responsible person", loading: "Loading…", find: "Search", total: "Balance rows", changed: " · Select Search to apply the query", columns: ["Name / code", "Account", "Quantity / unit", "Book price, KZT", "Warehouse", "Responsible person"], inventory: "Inv. no.", barcode: "Barcode", unspecified: "Not specified", none: "No results", empty: "No materials with a positive balance", previous: "Previous", page: "Page", of: "of", next: "Next", loadingList: "Loading list…", error: "Could not load the list. Try again." },
} as const;

export default function MaterialRegistryPanel({ source }: { source: MaterialRegistryMetadata | null }) {
  const { language, locale } = useAppSettings();
  const c = copy[language];
  const { page, search, setSearch, appliedSearch, busy, error, load } = useOneCRegistry<{ row_key: string; payload: OneCMaterial }>("/api/integrations/1c/materials/registry", source?.sha256);

  return <section aria-label={c.title} aria-busy={busy} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">{c.title}</h2>
    <p className="text-sm text-slate-500">{c.active}</p>
    <form onSubmit={event => { event.preventDefault(); void load(1, search); }} className="flex flex-wrap gap-2">
      <input aria-label={c.search} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder={c.placeholder} value={search} onChange={event => setSearch(event.target.value)} maxLength={255} />
      <button disabled={busy} className="rounded-xl bg-[#002060] px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? c.loading : c.find}</button>
    </form>
    {error ? <p role="alert" className="text-sm text-red-700">{c.error}</p> : null}
    {page ? <>
      <p role="status" className="text-sm">{c.total}: <strong>{page.total.toLocaleString(locale)}</strong>{search !== appliedSearch ? c.changed : ""}</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{c.columns.map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{page.data.map(({ row_key, payload: m }) => <tr key={row_key} className="border-t align-top">
          <td className="p-2">{m.name}<div className="font-mono">{m.code}</div><div>{c.inventory}: {m.inventoryNumber ?? "—"} · {c.barcode}: {m.barcode ?? "—"}</div></td>
          <td className="p-2">{m.accountCode ?? "—"}</td><td className="p-2">{m.quantity} {m.unit ?? ""}</td>
          <td className="p-2">{m.unitPrice === null ? "—" : Number(m.unitPrice).toLocaleString(locale, { maximumFractionDigits: 2 })}</td><td className="p-2">{m.warehouseName ?? m.warehouseCode ?? "—"}</td>
          <td className="p-2">{m.responsibleName ?? c.unspecified}<div>{m.responsibleCode ?? ""}</div></td>
        </tr>)}{page.data.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">{appliedSearch ? c.none : c.empty}</td></tr> : null}</tbody></table></div>
      <div className="flex items-center gap-3"><button type="button" disabled={busy || page.page <= 1 || search !== appliedSearch} onClick={() => void load(page.page - 1, appliedSearch)} className="rounded border px-3 py-1 text-sm disabled:opacity-40">{c.previous}</button><span className="text-xs text-slate-500">{c.page} {page.page} {c.of} {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><button type="button" disabled={busy || page.page * page.pageSize >= page.total || search !== appliedSearch} onClick={() => void load(page.page + 1, appliedSearch)} className="rounded border px-3 py-1 text-sm disabled:opacity-40">{c.next}</button></div>
    </> : busy ? <p role="status" className="text-sm text-slate-500">{c.loadingList}</p> : null}
  </section>;
}
