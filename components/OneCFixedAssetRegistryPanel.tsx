"use client";

import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { useOneCRegistry } from "@/lib/use-one-c-registry";

export default function OneCFixedAssetRegistryPanel({ revision }: { revision?: string | null }) {
  const { page, search, setSearch, appliedSearch, busy, error, load } = useOneCRegistry<{ external_id: string; payload: OneCFixedAsset }>("/api/integrations/1c/assets/registry", revision);
  const money = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  return <section aria-label="Основные средства" aria-busy={busy} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">Основные средства</h2><p className="mt-1 text-sm text-slate-500">Только на учёте</p></div>
    <form onSubmit={event => { event.preventDefault(); void load(1, search); }} className="flex flex-wrap gap-2">
      <input aria-label="Поиск основных средств" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Название, код, номер, штрихкод или ответственный" value={search} onChange={event => setSearch(event.target.value)} maxLength={255} />
      <button disabled={busy} className="rounded-xl bg-[#002060] px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? "Загрузка…" : "Найти"}</button>
    </form>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {page ? <>
      <p role="status" className="text-sm text-slate-600">На учёте: <strong>{page.total.toLocaleString("ru-RU")}</strong>{search !== appliedSearch ? " · Нажмите «Найти», чтобы применить поиск" : ""}</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{["Наименование / код", "Инвентарный номер / штрихкод", "Количество", "Первоначальная стоимость, KZT", "Остаточная стоимость, KZT", "Подразделение", "Ответственный"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{page.data.map(({ external_id, payload: a }) => <tr key={external_id} className="border-t border-slate-100 align-top hover:bg-slate-50">
          <td className="p-3">{a.name}<div className="mt-1 font-mono text-slate-500">{a.code ?? "—"}</div></td>
          <td className="p-3"><div>{a.inventoryNumber ?? "—"}</div><div className="mt-1 text-slate-500">{a.barcode ?? "—"}</div></td><td className="p-3">{a.quantity}</td>
          <td className="p-3">{money(a.initialCost)}</td><td className="p-3">{money(a.residualCost)}</td><td className="p-3">{a.location ?? "—"}</td><td className="p-3">{a.responsibleName ?? "Не указан"}</td>
        </tr>)}{page.data.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-slate-500">{appliedSearch ? "Ничего не найдено" : "Нет основных средств на учёте"}</td></tr> : null}</tbody></table></div>
      <div className="flex items-center gap-3"><button type="button" disabled={busy || page.page <= 1 || search !== appliedSearch} onClick={() => void load(page.page - 1, appliedSearch)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Назад</button><span className="text-xs text-slate-500">Страница {page.page} из {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><button type="button" disabled={busy || page.page * page.pageSize >= page.total || search !== appliedSearch} onClick={() => void load(page.page + 1, appliedSearch)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Далее</button></div>
    </> : busy ? <p role="status" className="text-sm text-slate-500">Загрузка списка…</p> : null}
  </section>;
}
