"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Sparkles, ShieldCheck } from "lucide-react";
import type { InventoryAuditEnrichmentRow } from "@/lib/inventory-audit-enrichment";

type Plan = { runId: string; planHash: string; counts: { ready: number; unchanged: number; skipped: number }; rows: InventoryAuditEnrichmentRow[]; sources?: { fixedAssets: number; materials: number; materialBalances: number; cards: number } };
type Props = { batchId: string; runId: string; blocked: boolean; currentRegistry?: boolean; onApplied(): void };

const blockedMessage = "Для проверки обновлений нужна актуальная сводка. Дождитесь завершения операции и при необходимости запустите сверку заново.";

export function EnrichmentDescription() {
  return <>
    <div className="flex flex-wrap items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-100 text-teal-700"><Sparkles aria-hidden="true" className="h-5 w-5" /></span><div><h3 className="font-semibold text-slate-900">Названия и коды 1С в карточках ТМЦ</h3><p className="mt-0.5 text-xs text-teal-700">Общий список · основные средства и материальные предметы</p></div></div>
  </>;
}

export function InventoryCurrentEnrichment({ blocked = false, onApplied }: { blocked?: boolean; onApplied(): void }) {
  return <EnrichmentReview batchId="" runId="current-registry" currentRegistry blocked={blocked} onApplied={onApplied} />;
}

export default function InventoryAuditEnrichment({ batchId, runId, blocked, onApplied }: Props) {
  return <EnrichmentReview key={`${batchId}:${runId}`} batchId={batchId} runId={runId} blocked={blocked} onApplied={onApplied} />;
}

export function EnrichmentReview({ batchId, runId, blocked, currentRegistry = false, onApplied }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rowFilter, setRowFilter] = useState("ready");
  const [search, setSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [previousBlocked, setPreviousBlocked] = useState(blocked);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  if (blocked !== previousBlocked) {
    setPreviousBlocked(blocked);
    if (blocked) { setPlan(null); setBusy(false); setUncertain(false); }
  }
  useEffect(() => { if (blocked) { generation.current++; request.current?.abort(); } }, [blocked]);

  async function perform(apply: boolean) {
    if (busy || blocked || (apply && !plan)) return;
    const reviewedPlan = plan;
    const current = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    let definitiveFailure = false;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(currentRegistry ? "/api/integrations/1c/enrichment" : `/api/integrations/1c/batches/${batchId}/audit/enrichment`, {
        method: apply ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        ...(apply ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: reviewedPlan!.runId, planHash: reviewedPlan!.planHash }) } : {}),
      });
      const body = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) {
        if (response.status === 409) {
          definitiveFailure = true; setPlan(null); setUncertain(false);
          throw new Error(body.error === "inventory_audit_enrichment_shared_number_conflict"
            ? "Обновление отменено: название нарушает правило общего номера для монитора и системного блока. Проверьте карточки с одинаковым номером и запустите dry-run заново."
            : currentRegistry ? "Данные 1С или карточки изменились. Повторите проверку обновлений." : "Сверка или карточки изменились. Запустите dry-run заново и проверьте изменения.");
        }
        if (response.status === 401 || response.status === 403) { definitiveFailure = true; setPlan(null); setUncertain(false); throw new Error("Недостаточно прав для обновления карточек."); }
        throw new Error("Не удалось получить результат. Повторите проверку.");
      }
      if (apply) {
        if (!body.result || !Number.isSafeInteger(body.result.updated)) throw new Error("Не удалось получить результат. Повторите проверку.");
        setMessage(`Обновлено карточек: ${body.result.updated}. Без изменений: ${body.result.unchanged}. Пропущено: ${body.result.skipped}.${currentRegistry ? "" : " Запустите dry-run заново для обновлённой сводки."}`);
        setPlan(null); setUncertain(false); onApplied();
      } else {
        if (body.plan?.runId !== runId || !/^[a-f0-9]{64}$/u.test(body.plan?.planHash ?? "") || !Array.isArray(body.plan?.rows)) throw new Error("Сверка изменилась. Обновите её и повторите проверку.");
        setPlan(body.plan);
        setRowFilter(body.plan.counts.ready > 0 ? "ready" : body.plan.counts.skipped > 0 ? "skipped" : "unchanged");
        setUncertain(false);
      }
    } catch (failure) {
      if (current !== generation.current || controller.signal.aborted) return;
      if (apply && !definitiveFailure) setUncertain(true);
      setError(failure instanceof Error ? failure.message : "Не удалось получить результат. Повторите проверку.");
    } finally { if (current === generation.current) setBusy(false); }
  }

  const skippedReasons = new Map<string, { label: string; count: number }>();
  for (const row of plan?.rows ?? []) {
    if (row.eligible) continue;
    const key = reasonKey(row);
    const group = skippedReasons.get(key) ?? { label: reasonLabel(row, currentRegistry), count: 0 };
    group.count++;
    skippedReasons.set(key, group);
  }
  const reasonCounts = [...skippedReasons].sort(([, left], [, right]) => right.count - left.count || left.label.localeCompare(right.label, "ru"));
  const filteredRows = (plan?.rows ?? []).filter((row) => {
    const needle = search.normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
    if (needle && ![row.itemId, row.currentName, row.nextName, row.currentCode, row.nextCode, row.siteNumber, row.identityEvidence, row.searchText,
      row.responsibility?.sourceName, row.responsibility?.currentName, row.responsibility?.nextName].some(value => value?.normalize("NFKC").toLocaleLowerCase("ru-RU").includes(needle))) return false;
    if (rowFilter === "ready") return row.eligible && row.changed;
    if (rowFilter === "unchanged") return row.eligible && !row.changed;
    if (rowFilter === "skipped") return !row.eligible;
    if (rowFilter.startsWith("reason:")) return !row.eligible && reasonKey(row) === rowFilter.slice(7);
    return true;
  });
  const visibleRows = currentRegistry ? filteredRows.slice(0, visibleLimit) : filteredRows;

  return <section className="space-y-4 rounded-2xl border border-teal-200/70 bg-gradient-to-br from-white via-teal-50/60 to-sky-50/60 p-5 shadow-sm shadow-teal-900/5 sm:p-6" aria-label="Обновление названий и кодов 1С">
    <EnrichmentDescription />
    {blocked ? <p className="text-sm text-amber-800">{blockedMessage}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || blocked || uncertain} onClick={() => void perform(false)} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-50"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Проверка…" : "Проверить обновления названий и кодов"}</button>
      {plan?.counts.ready ? <button disabled={busy || blocked} onClick={() => void perform(true)} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50">{uncertain ? "Проверить результат обновления" : `Применить ${plan.counts.ready} обновлений`}</button> : null}
    </div>
    {!plan ? <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-teal-600" />Сначала просмотр изменений, затем применение.</p> : null}
    {plan ? <><p className="text-sm">Можно обновить: {plan.counts.ready}. Без изменений: {plan.counts.unchanged}. Пропущено: {plan.counts.skipped}.</p>
      {plan.sources ? <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{[["ОС проверено", plan.sources.fixedAssets], ["МП проверено", plan.sources.materials], ["Карточек проверено", plan.sources.cards], ["Готово к обновлению", plan.counts.ready]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/80 bg-white/80 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900">{value}</p></div>)}</div> : null}
      {reasonCounts.length ? <ul aria-label="Причины пропуска" className="space-y-1 text-sm text-zinc-600">{reasonCounts.map(([key, reason]) => <li key={key}>{reason.label}: <span className="font-medium text-zinc-900">{reason.count}</span></li>)}</ul> : null}
      <details open={currentRegistry || undefined}><summary className="cursor-pointer text-sm font-medium text-teal-800">Показать изменения и причины пропуска</summary>
        {currentRegistry ? <input aria-label="Поиск по всем карточкам сверки" value={search} onChange={event => { setSearch(event.target.value); setRowFilter("all"); setVisibleLimit(100); }} placeholder="Название, номер, штрихкод, код 1С или ответственный" className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100" /> : null}
        <select aria-label="Какие обновления показать" value={rowFilter} onChange={(event) => { setRowFilter(event.target.value); setVisibleLimit(100); }} className="mt-3 max-w-full rounded-lg border px-3 py-2 text-sm">
          <option value="ready">Готовые к обновлению ({plan.counts.ready})</option>
          <option value="unchanged">Без изменений ({plan.counts.unchanged})</option>
          <option value="skipped">Пропущенные ({plan.counts.skipped})</option>
          <option value="all">Все карточки ({plan.rows.length})</option>
          {reasonCounts.length ? <optgroup label="Причины пропуска">{reasonCounts.map(([key, reason]) => <option key={key} value={`reason:${key}`}>{reason.label} ({reason.count})</option>)}</optgroup> : null}
        </select>
        {currentRegistry ? <p className="mt-2 text-xs text-slate-500">Показано {visibleRows.length} из {filteredRows.length}. Поиск выполняется по всему списку выбранной группы.</p> : null}
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-xl border border-teal-100 bg-white/90"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-slate-600"><tr>{["ТМЦ", "Новое название", "Источник названия и кода", "Код 1С после обновления", "Результат", ...(currentRegistry ? ["Ответственный"] : [])].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.itemId} className="border-t border-teal-100 align-top"><td className="p-3"><Link href={`/items/${row.itemId}`} className="text-teal-800">{row.currentName}</Link>{currentRegistry && row.siteNumber ? <p className="mt-1 font-mono text-xs text-slate-500">{row.siteNumber}</p> : null}</td><td className="p-3">{row.eligible ? row.nextName : "—"}</td><td className="p-3">{row.eligible ? row.nameSource === "materials_api" ? "МП" : row.nameSource === "excel" ? "Excel" : currentRegistry ? "ОС" : "1С" : "—"}{currentRegistry && row.identityEvidence ? <p className="mt-1 text-xs text-slate-500">Совпало: {row.identityEvidence}</p> : null}</td><td className="p-3"><span className="font-mono">{row.eligible ? row.nextCode ?? "—" : "—"}</span>{row.eligible && row.currentCode && row.currentCode !== row.nextCode ? <p className="mt-1 text-xs text-zinc-600">Было: {row.currentCode}</p> : null}{row.eligible && row.codeStatus && row.codeStatus !== "confirmed" ? <p className="mt-1 text-xs text-zinc-600">Код сохранён без изменения: {reasonLabel({ ...row, reason: row.codeStatus }, currentRegistry)}</p> : null}</td><td className="p-3">{row.eligible ? row.changed ? "Готово к обновлению" : "Без изменений" : reasonLabel(row, currentRegistry)}</td>{currentRegistry ? <td className="min-w-64 p-3"><ResponsibilityPreview row={row} /></td> : null}</tr>)}
            {!visibleRows.length ? <tr><td colSpan={currentRegistry ? 6 : 5} className="p-3 text-zinc-500">В этой группе нет карточек.</td></tr> : null}
          </tbody></table></div>
        {currentRegistry && visibleRows.length < filteredRows.length ? <button type="button" onClick={() => setVisibleLimit(value => value + 100)} className="mt-3 rounded-xl border border-teal-200 bg-white px-4 py-2 text-sm text-teal-800">Показать ещё 100</button> : null}
      </details></> : null}
  </section>;
}

export function ResponsibilityPreview({ row }: { row: InventoryAuditEnrichmentRow }) {
  const proposal = row.responsibility;
  if (!proposal) return <>Без изменений</>;
  const labels: Record<NonNullable<InventoryAuditEnrichmentRow["responsibility"]>["status"], string> = {
    ready: "Будет назначен", unchanged: "Уже назначен", not_allowed: "Другой сотрудник — без изменений",
    ambiguous: "Ответственный в 1С неоднозначен", user_missing: "Сотрудник не найден на сайте", user_ambiguous: "На сайте несколько сотрудников с таким именем",
    pending_transfer: "Есть незавершённая передача", unavailable: "Назначение сейчас недоступно", unconfirmed: "Нет подтверждённого совпадения",
  };
  return <><p className={proposal.changed ? "font-medium text-teal-800" : "text-slate-600"}>{proposal.changed ? proposal.nextName : proposal.currentName ?? "Не назначен"}</p>
    {proposal.changed ? <p className="mt-1 text-xs text-slate-500">Было: {proposal.currentName ?? "Не назначен"}</p> : null}
    {proposal.sourceName ? <p className="mt-1 text-xs text-slate-500">В 1С: {proposal.sourceName}</p> : null}
    <p className="mt-1 text-xs text-slate-500">{labels[proposal.status]}</p></>;
}

function reasonKey(row: InventoryAuditEnrichmentRow) {
  return row.reason === "sources_missing" ? `${row.reason}:${(row.missingSources ?? []).join(",")}` : row.reason;
}

function reasonLabel(row: InventoryAuditEnrichmentRow, currentRegistry = false) {
  const label = legacyReasonLabel(row);
  return currentRegistry ? label.replaceAll("материалах API 1С", "материальных предметах 1С").replaceAll("партию и полный номер", "реестр и полный номер") : label;
}

function legacyReasonLabel(row: InventoryAuditEnrichmentRow) {
  if (row.reason === "sources_missing" && row.missingSources?.length) {
    if (row.missingSources.length === 2) return "Нет подтверждения в ОС и материалах API 1С — проверьте оба источника";
    return row.missingSources[0] === "1c"
      ? "Нет подтверждения в ОС 1С — проверьте партию и полный номер"
      : "Нет подтверждения в материалах API 1С — проверьте реестр и полный номер";
  }
  const labels: Record<string, string> = {
    shared_number_conflict: "Новое название нарушает правило общего номера для монитора и системного блока — проверьте обе карточки, включая архив",
    sources_missing: "Нет подтверждения в источниках — проверьте полные номера", code_missing: "Код не указан в выбранной записи источника",
    code_invalid: "Код выбранной записи не подходит для сохранения",
    code_conflict: "Коды источников или карточки не совпадают — проверьте значения",
    source_ambiguous: "Найдено несколько вариантов — проверьте записи источников", identity_conflict: "Номера или штрихкоды не совпадают — проверьте полные значения",
    item_ineligible: "Карточка архивирована или относится к разделу IT", name_invalid: "Название не подходит для сохранения",
    item_changed: "Карточка изменена после сверки", source_reused: "Запись источника соответствует нескольким карточкам",
    item_not_found: "Карточка больше не существует", identity_missing: "Полный номер или официальный штрихкод не подтверждены",
  };
  return labels[row.reason] ?? "Требуется ручная проверка номера и кода";
}
