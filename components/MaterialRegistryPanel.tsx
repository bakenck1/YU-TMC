"use client";

import { useEffect, useRef, useState } from "react";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import type { MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";

type Page = { data: { row_key: string; payload: OneCMaterial }[]; page: number; pageSize: number; total: number };

export default function MaterialRegistryPanel({ source }: { source: MaterialRegistryMetadata | null }) {
  const [page, setPage] = useState<Page | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => () => { generation.current++; }, []);
  async function load(number: number) {
    const requestId = ++generation.current;
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(number), pageSize: "50", search });
      const response = await fetch(`/api/integrations/1c/materials/registry?${params}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("registry_unavailable");
      const result = await response.json() as Page;
      if (requestId === generation.current) { setPage(result); setAppliedSearch(search); }
    } catch { if (requestId === generation.current) setError("Не удалось прочитать реестр материалов. Проверьте доступ и повторите запрос."); }
    finally { if (requestId === generation.current) setBusy(false); }
  }

  return <section aria-label="Материальный предмет" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Материальный предмет</h2>
    {source?.batchId ? <>
      <p className="text-sm text-slate-600">Позиций: <strong>{source.materialCount}</strong> · Строк остатков: <strong>{source.rowCount}</strong> · С наличием: <strong>{source.positiveRows}</strong></p>
    </> : <p role="status" className="text-sm text-slate-500">Нет данных</p>}
    <form onSubmit={event => { event.preventDefault(); void load(1); }} className="flex flex-wrap gap-2">
      <input aria-label="Поиск материального предмета" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="Название, код, номер или ответственный" value={search} onChange={event => setSearch(event.target.value)} maxLength={255} />
      <button disabled={busy} className="rounded-xl bg-[#002060] px-5 py-2.5 text-sm text-white disabled:opacity-50">{busy ? "Загрузка…" : "Найти предмет"}</button>
    </form>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {page ? <>
      <p className="text-sm">Найдено строк: {page.total}.{search !== appliedSearch ? " Поиск изменён — нажмите кнопку поиска." : ""}</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr>{["Номенклатура / код", "Счёт", "Количество / ед.", "Учётная цена, KZT", "Склад", "МОЛ"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{page.data.map(({ row_key, payload: m }) => <tr key={row_key} className="border-t align-top">
          <td className="p-2">{m.name}<div className="font-mono">{m.code}</div><div>Инв. №: {m.inventoryNumber ?? "—"} · Штрихкод: {m.barcode ?? "—"}</div></td>
          <td className="p-2">{m.accountCode ?? "Не передан"}</td><td className="p-2">{m.quantity} {m.unit ?? ""}</td>
          <td className="p-2">{m.unitPrice ?? "Не передана"}</td><td className="p-2">{m.warehouseName ?? m.warehouseCode ?? "Не указан"}</td>
          <td className="p-2">{m.responsibleName ?? "Не указан"}<div>{m.responsibleCode ?? m.responsibleExternalId ?? ""}</div></td>
        </tr>)}</tbody></table></div>
      <div className="flex gap-2"><button type="button" disabled={busy || page.page <= 1 || search !== appliedSearch} onClick={() => void load(page.page - 1)} className="rounded border px-3 py-1 text-sm">Назад</button><button type="button" disabled={busy || page.page * page.pageSize >= page.total || search !== appliedSearch} onClick={() => void load(page.page + 1)} className="rounded border px-3 py-1 text-sm">Далее</button></div>
    </> : null}
  </section>;
}
