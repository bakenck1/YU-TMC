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

  return <section aria-label="Материалы из API 1С" className="space-y-3 rounded-2xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Материалы из API 1С</h2>
    <p className="text-sm text-zinc-600">Excel больше не используется как источник сверки. Материалы поступают через отдельный API 1С; карточки, цены и ответственные Inventory автоматически не перезаписываются.</p>
    {source?.batchId ? <>
      <p className="text-sm">В текущем реестре: <strong>{source.rowCount}</strong> строк остатков, <strong>{source.materialCount}</strong> кодов номенклатуры. С положительным остатком: {source.positiveRows}. Нулевые и отрицательные ({source.nonPositiveRows}) не подтверждают действующий остаток.</p>
      <p className="text-xs text-zinc-500">Последний пакет: {source.batchId}. Дата среза: {source.snapshotAt ? new Date(source.snapshotAt).toLocaleString("ru-RU") : "—"}. Получен: {source.receivedAt ? new Date(source.receivedAt).toLocaleString("ru-RU") : "—"}.</p>
      <p className="break-all text-xs text-zinc-500">SHA-256 текущего реестра: <code>{source.sha256}</code>. Количество и дата пакета не доказывают полноту базы университета.</p>
    </> : <p role="status" className="text-sm text-amber-800">Материалы через API ещё не получены. Сверка ОС работает без Excel; подтверждение материалов появится после их приёма.</p>}
    <form onSubmit={event => { event.preventDefault(); void load(1); }} className="flex flex-wrap gap-2">
      <input aria-label="Поиск в материалах 1С" className="min-w-64 rounded-lg border px-3 py-2 text-sm" placeholder="Код, номер, название, счёт или МОЛ" value={search} onChange={event => setSearch(event.target.value)} maxLength={255} />
      <button disabled={busy} className="rounded-lg border px-3 py-2 text-sm">{busy ? "Загрузка…" : "Показать материалы 1С"}</button>
    </form>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {page ? <>
      <p className="text-sm">Найдено строк: {page.total}.{search !== appliedSearch ? " Поиск изменён — нажмите кнопку поиска." : ""}</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr>{["Номенклатура / код", "Счёт", "Количество / ед.", "Учётная цена, KZT", "Склад", "МОЛ"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{page.data.map(({ row_key, payload: m }) => <tr key={row_key} className="border-t align-top">
          <td className="p-2">{m.name}<div className="font-mono">{m.code}</div><div>Инв. №: {m.inventoryNumber ?? "—"} · barcode: {m.barcode ?? "—"}</div></td>
          <td className="p-2">{m.accountCode ?? "Не передан"}</td><td className="p-2">{m.quantity} {m.unit ?? ""}</td>
          <td className="p-2">{m.unitPrice ?? "Не передана"}</td><td className="p-2">{m.warehouseName ?? m.warehouseCode ?? "Не указан"}</td>
          <td className="p-2">{m.responsibleName ?? "Не указан"}<div>{m.responsibleCode ?? m.responsibleExternalId ?? ""}</div></td>
        </tr>)}</tbody></table></div>
      <div className="flex gap-2"><button type="button" disabled={busy || page.page <= 1 || search !== appliedSearch} onClick={() => void load(page.page - 1)} className="rounded border px-3 py-1 text-sm">Назад</button><button type="button" disabled={busy || page.page * page.pageSize >= page.total || search !== appliedSearch} onClick={() => void load(page.page + 1)} className="rounded border px-3 py-1 text-sm">Далее</button></div>
    </> : null}
  </section>;
}
