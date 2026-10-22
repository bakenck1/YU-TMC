"use client";

import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import type { MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";
import { useOneCRegistry } from "@/lib/use-one-c-registry";

export default function MaterialRegistryPanel({ source }: { source: MaterialRegistryMetadata | null }) {
  const { page, search, setSearch, appliedSearch, busy, error, load } = useOneCRegistry<{ row_key: string; payload: OneCMaterial }>("/api/integrations/1c/materials/registry", source?.sha256);

  return <section aria-label="Материальный предмет" aria-busy={busy} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Материальный предмет</h2>
    <p className="text-sm text-slate-500">Только с положительным остатком</p>
    <form onSubmit={event => { event.preventDefault(); void load(1, search); }} className="flex flex-wrap gap-2">
      <input aria-label="Поиск материального предмета" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Название, код, номер, штрихкод или ответственный" value={search} onChange={event => setSearch(event.target.value)} maxLength={255} />
      <button disabled={busy} className="rounded-xl bg-[#002060] px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? "Загрузка…" : "Найти"}</button>
    </form>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {page ? <>
      <p role="status" className="text-sm">Строк остатков: <strong>{page.total.toLocaleString("ru-RU")}</strong>{search !== appliedSearch ? " · Нажмите «Найти», чтобы применить поиск" : ""}</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{["Наименование / код", "Счёт", "Количество / ед.", "Учётная цена, KZT", "Склад", "Ответственный"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{page.data.map(({ row_key, payload: m }) => <tr key={row_key} className="border-t align-top">
          <td className="p-2">{m.name}<div className="font-mono">{m.code}</div><div>Инв. №: {m.inventoryNumber ?? "—"} · Штрихкод: {m.barcode ?? "—"}</div></td>
          <td className="p-2">{m.accountCode ?? "—"}</td><td className="p-2">{m.quantity} {m.unit ?? ""}</td>
          <td className="p-2">{m.unitPrice === null ? "—" : Number(m.unitPrice).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</td><td className="p-2">{m.warehouseName ?? m.warehouseCode ?? "—"}</td>
          <td className="p-2">{m.responsibleName ?? "Не указан"}<div>{m.responsibleCode ?? ""}</div></td>
        </tr>)}{page.data.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">{appliedSearch ? "Ничего не найдено" : "Нет материальных предметов с положительным остатком"}</td></tr> : null}</tbody></table></div>
      <div className="flex items-center gap-3"><button type="button" disabled={busy || page.page <= 1 || search !== appliedSearch} onClick={() => void load(page.page - 1, appliedSearch)} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Назад</button><span className="text-xs text-slate-500">Страница {page.page} из {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><button type="button" disabled={busy || page.page * page.pageSize >= page.total || search !== appliedSearch} onClick={() => void load(page.page + 1, appliedSearch)} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Далее</button></div>
    </> : busy ? <p role="status" className="text-sm text-slate-500">Загрузка списка…</p> : null}
  </section>;
}
