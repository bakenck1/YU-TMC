"use client";

import Link from "next/link";
import { useState } from "react";
import { auditNeedsReview, INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION } from "@/lib/inventory-source-audit-review";
import type { AuditMatch, AuditCounts, ExcelSourceRow } from "@/lib/inventory-source-audit";
import type { InventoryAuditInventoryState, MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";
import InventoryAuditEnrichment from "@/components/InventoryAuditEnrichment";

export type AuditPage = { run: {
  id: string; batch_id: string; batch_version: number; algorithm_version?: string | null;
  one_c_registry_sha256: string; sha256: string; run_at: string; counts: AuditCounts;
  material_source?: MaterialRegistryMetadata | null; inventory?: InventoryAuditInventoryState;
}; data: AuditMatch[]; page: number; pageSize: number; total: number };

type Props = { batchId: string; audit: AuditPage; busy: boolean; showEnrichment?: boolean; onLoad(page: number, filters: { search?: string; result?: string; source?: string; pageSize?: number }): void };
const sourceLabel = (value: AuditMatch["source"]) => value === "1c+excel" ? "Основные средства + Материалы" : value === "1c" ? "Основные средства" : value === "excel" ? "Материалы" : "—";
const evidenceLabel = (value: string) => ({
  guid: "связь GUID", code: "код 1С", inventory_number: "номер сайта", barcode: "штрихкод",
  site_number: "номер сайта", batch_analysis: "анализ партии основных средств",
  number_without_slash: "номер без / — проверить", number_in_description: "номер в описании — проверить",
  number_format: "формат номера — проверить", number_suffix: "суффикс номера — проверить",
  number_spaces: "номер без пробелов — проверить",
} as Record<string, string>)[value] ?? value;

export default function InventorySourceAuditPanel({ batchId, audit, busy, showEnrichment = true, onLoad }: Props) {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState("");
  const [source, setSource] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const filters = { search, result, source, pageSize };
  const counts = audit.run.counts, inventory = audit.run.inventory;
  const liveApi = audit.run.material_source?.kind === "materials_api";
  const outdated = !liveApi || audit.run.algorithm_version !== String(INVENTORY_SOURCE_AUDIT_ALGORITHM_VERSION);
  if (!liveApi) return <section aria-label="Сводка по всем ТМЦ" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
    <p role="alert">Историческая сводка использовала Excel и не участвует в текущей аналитике. Запустите dry-run заново: сверка возьмёт Основные средства и МП только из полученных реестров 1С.</p>
    {showEnrichment ? <InventoryAuditEnrichment key={audit.run.id} batchId={batchId} runId={audit.run.id} blocked onApplied={() => onLoad(audit.page, filters)} /> : null}
  </section>;
  return <section className="space-y-3" aria-label="Сводка по всем ТМЦ">
    {outdated ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Историческая сводка: источник материалов — прежний Excel или версия поиска устарела. Запустите dry-run заново для сверки с API 1С. Применение старых предложений заблокировано.</p> : null}
    {inventory?.stale ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Данные после сверки изменились: добавлено {inventory.added}, удалено {inventory.removed}, изменено {inventory.changed}.{inventory.linksChanged ? " Изменились связи карточек с основными средствами." : ""}{inventory.materialSourceChanged ? " Изменился источник материалов 1С." : ""} Запустите dry-run заново.</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Сверка всех ТМЦ сайта</h2><p className="text-xs text-zinc-500">{liveApi ? "Источники: выбранная партия и текущий реестр основных средств, а также текущие материалы из API 1С. Нулевые и отрицательные остатки материалов не подтверждают действующий остаток." : "Сохранённые исторические результаты; материалы в этой сводке получены из Excel."} Совпадение учётных данных не подтверждает физическое наличие. Сверка не меняет карточки автоматически.</p></div>
      <a href={`/api/integrations/1c/batches/${batchId}/audit/export`} className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-700">Скачать сводку Excel</a>
    </div>
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-7">{[["Карточек в сводке", counts.total], ["Основные средства", counts.oneCOnly], ["Материалы", counts.excelOnly], ["Основные средства + Материалы", counts.both], ["Не найдено в источниках", counts.missing], ["Из ненайденных: временные", counts.temporary], ["Из найденных: возможные", counts.possible ?? 0]].map(([name, value]) => <div key={name} className="rounded-xl border bg-white p-3"><div className="text-xs text-zinc-500">{name}</div><div className="text-lg font-semibold">{value}</div></div>)}</div>
    <p className="text-xs text-zinc-600">Основные средства — совпадение только в основных средствах; материалы — только в источнике материалов; Основные средства + Материалы — одна карточка найдена в обоих источниках и считается один раз. Это результаты поиска, а не присвоение учётной категории.</p>
    <p className="text-xs text-zinc-600">{counts.oneCOnly} + {counts.excelOnly} + {counts.both} + {counts.missing} = {counts.total}. Временные номера ({counts.temporary}) входят в ненайденные ({counts.missing}); возможные ({counts.possible ?? 0}) — в найденные и требуют проверки.</p>
    {inventory ? <div className="text-xs text-zinc-600"><p>Сейчас на сайте: {inventory.currentTotal} карточек, активных: {inventory.currentActive}. Сводка включает все неархивные карточки независимо от статуса.</p><p>Количество единиц: {inventory.currentQuantity}, в активных карточках: {inventory.currentActiveQuantity}. Одна карточка может содержать несколько единиц.</p></div> : null}
    <p className="break-all text-xs text-zinc-500">Партия основных средств: {audit.run.batch_id}, версия {audit.run.batch_version}. SHA-256 реестра основных средств: <code>{audit.run.one_c_registry_sha256}</code>. SHA-256 {liveApi ? "материалов API 1С" : "исторического Excel"}: <code>{audit.run.sha256}</code>. Запуск: {new Date(audit.run.run_at).toLocaleString("ru-RU")}</p>
    {showEnrichment ? <InventoryAuditEnrichment key={audit.run.id} batchId={batchId} runId={audit.run.id} blocked={busy || outdated || !!inventory?.stale} onApplied={() => onLoad(audit.page, filters)} /> : null}
    <div className="overflow-hidden rounded-2xl border bg-white">
      <form onSubmit={event => { event.preventDefault(); onLoad(1, filters); }} className="flex flex-wrap gap-2 border-b p-3">
        <input aria-label="Поиск ТМЦ в сводке" value={search} onChange={event => setSearch(event.target.value)} placeholder="Название, номер, штрихкод, код 1С или МОЛ" className="min-w-60 rounded-lg border px-3 py-2 text-sm" />
        <select aria-label="Итог сводки" value={result} onChange={event => { setResult(event.target.value); onLoad(1, { ...filters, result: event.target.value }); }} className="rounded-lg border px-3 py-2 text-sm"><option value="">Все итоги</option><option value="matched">Найдено совпадение</option><option value="missing">Не найдено</option><option value="temporary">Временный номер</option></select>
        <select aria-label="Источник сводки" value={source} onChange={event => { setSource(event.target.value); onLoad(1, { ...filters, source: event.target.value }); }} className="rounded-lg border px-3 py-2 text-sm"><option value="">Все источники</option><option value="1c">Основные средства</option><option value="excel">Материалы</option><option value="1c+excel">Основные средства + Материалы</option></select>
        <select aria-label="Строк сводки на странице" value={pageSize} onChange={event => { const size = Number(event.target.value); setPageSize(size); onLoad(1, { ...filters, pageSize: size }); }} className="rounded-lg border px-3 py-2 text-sm"><option value="50">50 строк</option><option value="100">100 строк</option></select>
        <button className="rounded-lg border px-3 py-2 text-sm">Найти</button>
      </form>
      {busy ? <p className="p-5 text-sm">Загрузка…</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-zinc-50"><tr>{["Итог", "Источник", "ТМЦ сайта / номера", liveApi ? "Материалы API 1С / остатки по МОЛ" : "Исторический Excel", "Основные средства 1С"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{audit.data.map(row => <tr key={row.itemId} className="border-t align-top">
        <td className="p-3">{auditNeedsReview(row) ? "Возможное совпадение — проверьте идентификаторы" : row.result === "matched" ? "Найдено совпадение" : row.result === "temporary" ? "Временный номер — требуется проверка" : "Не найдено"}</td>
        <td className="p-3">{sourceLabel(row.source)}</td>
        <td className="p-3"><Link href={`/items/${row.itemId}`} className="text-blue-700 hover:underline">{row.itemName}</Link><div>Номер: {row.siteNumber}</div>{row.siteBarcodes.map(barcode => <div key={`${barcode.kind}:${barcode.value}`}>{barcode.kind === "official" ? "Официальный" : "Локальный"} штрихкод: <code>{barcode.value}</code></div>)}</td>
        <td className="min-w-72 p-3">{row.excel.length ? <><MaterialEvidence entry={row.excel[0]} />{row.excel.length > 1 ? <details className="mt-2"><summary className="cursor-pointer text-blue-700">Все строки остатков / варианты: {row.excel.length}</summary>{row.excel.slice(1).map(entry => <div key={entry.rowNumber} className="mt-2 border-t pt-2"><MaterialEvidence entry={entry} /></div>)}</details> : null}</> : "—"}</td>
        <td className="min-w-60 p-3">{row.oneC.length ? row.oneC.map(entry => <div key={`${entry.externalId}:${entry.origins?.join(",")}`} className="mb-3"><code>{entry.externalId}</code><div>{entry.name}</div><div>Код 1С: {entry.code ?? "—"}</div><div>Номер: {entry.inventoryNumber ?? "—"} · barcode: {entry.barcode ?? "—"}</div><div>Источник: {entry.origins?.includes("current_registry") ? "текущий реестр" : "только выбранная партия"}</div><div>Найдено по: {entry.matchedBy.map(evidenceLabel).join(", ")}</div><div>Статус учёта 1С: {entry.status}</div>{entry.reviewState ? <div>Проверка партии: {entry.reviewState}</div> : null}</div>) : "—"}</td>
      </tr>)}</tbody></table></div>}
      <div className="flex items-center justify-between border-t p-3 text-sm"><span>Показано {audit.total ? (audit.page - 1) * audit.pageSize + 1 : 0}–{Math.min(audit.page * audit.pageSize, audit.total)} из {audit.total}</span><div className="flex gap-2"><button disabled={audit.page <= 1 || busy} onClick={() => onLoad(audit.page - 1, filters)} className="rounded border px-3 py-1">Назад</button><button disabled={audit.page * audit.pageSize >= audit.total || busy} onClick={() => onLoad(audit.page + 1, filters)} className="rounded border px-3 py-1">Далее</button></div></div>
    </div>
  </section>;
}

export function MaterialEvidence({ entry }: { entry: ExcelSourceRow }) {
  const api = entry.sourceKind === "materials_api";
  return <div><div>{entry.nomenclature}</div><div>Код 1С: {entry.oneCCode ?? "—"}{entry.materialGuid ? ` · GUID: ${entry.materialGuid}` : ""}</div><div>Номер: {entry.matchedInventoryNumber ?? entry.inventoryNumber ?? "—"}</div>
    <div>Найдено по: {entry.matchedBy?.map(evidenceLabel).join(", ") || "—"}</div>
    {api ? <><div>Счёт: {entry.accountCode ?? "—"} · Склад: {entry.warehouseName ?? entry.warehouseCode ?? "Не указан"}</div><div>МОЛ: {entry.responsibleName ?? "Не указан"} · {entry.responsibleCode ?? ""}</div><div>Остаток: {entry.endingBalance ?? "—"} {entry.unit ?? ""} · Учётная цена: {entry.unitPrice ?? "Не передана"} KZT</div></> : <div>Excel: строка {entry.rowNumber} · остаток {entry.endingBalance ?? "—"}</div>}
  </div>;
}
