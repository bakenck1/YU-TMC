"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { InventoryAuditEnrichmentRow } from "@/lib/inventory-audit-enrichment";

type Plan = { runId: string; planHash: string; counts: { ready: number; unchanged: number; skipped: number }; rows: InventoryAuditEnrichmentRow[] };
type Props = { batchId: string; runId: string; blocked: boolean; onApplied(): void };

export default function InventoryAuditEnrichment({ batchId, runId, blocked, onApplied }: Props) {
  return <EnrichmentReview key={`${batchId}:${runId}`} batchId={batchId} runId={runId} blocked={blocked} onApplied={onApplied} />;
}

export function EnrichmentReview({ batchId, runId, blocked, onApplied }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rowFilter, setRowFilter] = useState("ready");
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
      const response = await fetch(`/api/integrations/1c/batches/${batchId}/audit/enrichment`, {
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
            : "Сверка или карточки изменились. Запустите dry-run заново и проверьте изменения.");
        }
        if (response.status === 401 || response.status === 403) { definitiveFailure = true; setPlan(null); setUncertain(false); throw new Error("Недостаточно прав для обновления карточек."); }
        throw new Error("Не удалось получить результат. Повторите проверку.");
      }
      if (apply) {
        if (!body.result || !Number.isSafeInteger(body.result.updated)) throw new Error("Не удалось получить результат. Повторите проверку.");
        setMessage(`Обновлено карточек: ${body.result.updated}. Без изменений: ${body.result.unchanged}. Пропущено: ${body.result.skipped}. Запустите dry-run заново для обновлённой сводки.`);
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
    const group = skippedReasons.get(key) ?? { label: reasonLabel(row), count: 0 };
    group.count++;
    skippedReasons.set(key, group);
  }
  const reasonCounts = [...skippedReasons].sort(([, left], [, right]) => right.count - left.count || left.label.localeCompare(right.label, "ru"));
  const visibleRows = (plan?.rows ?? []).filter((row) => {
    if (rowFilter === "ready") return row.eligible && row.changed;
    if (rowFilter === "unchanged") return row.eligible && !row.changed;
    if (rowFilter === "skipped") return !row.eligible;
    if (rowFilter.startsWith("reason:")) return !row.eligible && reasonKey(row) === rowFilter.slice(7);
    return true;
  });

  return <section className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4" aria-label="Обновление названий и кодов 1С">
    <h3 className="font-semibold">Названия и коды 1С в карточках ТМЦ</h3>
    <p className="text-sm text-zinc-600">Наименование и код берутся из однозначного совпадения 1С. Если совпадения в 1С нет, оба значения берутся из Excel. Достаточно одного источника, подтверждённого полным номером или официальным штрихкодом карточки; неоднозначные записи пропускаются. Пустой или некорректный код источника оставляет прежний код карточки. Проверьте предложенные изменения перед применением.</p>
    {blocked ? <p className="text-sm text-amber-800">Для проверки обновлений нужна актуальная сводка. Дождитесь завершения операции и при необходимости запустите dry-run заново.</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || blocked || uncertain} onClick={() => void perform(false)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{busy ? "Проверка…" : "Проверить обновления названий и кодов"}</button>
      {plan?.counts.ready ? <button disabled={busy || blocked} onClick={() => void perform(true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">{uncertain ? "Проверить результат обновления" : `Применить ${plan.counts.ready} обновлений`}</button> : null}
    </div>
    {plan ? <><p className="text-sm">Можно обновить: {plan.counts.ready}. Без изменений: {plan.counts.unchanged}. Пропущено: {plan.counts.skipped}.</p>
      {reasonCounts.length ? <ul aria-label="Причины пропуска" className="space-y-1 text-sm text-zinc-600">{reasonCounts.map(([key, reason]) => <li key={key}>{reason.label}: <span className="font-medium text-zinc-900">{reason.count}</span></li>)}</ul> : null}
      <details><summary className="cursor-pointer text-sm text-blue-700">Показать изменения и причины пропуска</summary>
        <select aria-label="Какие обновления показать" value={rowFilter} onChange={(event) => setRowFilter(event.target.value)} className="mt-3 max-w-full rounded-lg border px-3 py-2 text-sm">
          <option value="ready">Готовые к обновлению ({plan.counts.ready})</option>
          <option value="unchanged">Без изменений ({plan.counts.unchanged})</option>
          <option value="skipped">Пропущенные ({plan.counts.skipped})</option>
          <option value="all">Все карточки ({plan.rows.length})</option>
          {reasonCounts.length ? <optgroup label="Причины пропуска">{reasonCounts.map(([key, reason]) => <option key={key} value={`reason:${key}`}>{reason.label} ({reason.count})</option>)}</optgroup> : null}
        </select>
        <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{["ТМЦ", "Новое название", "Источник названия и кода", "Код 1С после обновления", "Результат"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.itemId} className="border-t align-top"><td className="p-2"><Link href={`/items/${row.itemId}`} className="text-blue-700">{row.currentName}</Link></td><td className="p-2">{row.eligible ? row.nextName : "—"}</td><td className="p-2">{row.eligible ? row.nameSource === "excel" ? "Excel" : "1С" : "—"}</td><td className="p-2"><span className="font-mono">{row.eligible ? row.nextCode ?? "—" : "—"}</span>{row.eligible && row.currentCode && row.currentCode !== row.nextCode ? <p className="mt-1 text-xs text-zinc-600">Было: {row.currentCode}</p> : null}{row.eligible && row.codeStatus && row.codeStatus !== "confirmed" ? <p className="mt-1 text-xs text-zinc-600">Код сохранён без изменения: {reasonLabel({ ...row, reason: row.codeStatus })}</p> : null}</td><td className="p-2">{row.eligible ? row.changed ? "Готово к обновлению" : "Без изменений" : reasonLabel(row)}</td></tr>)}
            {!visibleRows.length ? <tr><td colSpan={5} className="p-3 text-zinc-500">В этой группе нет карточек.</td></tr> : null}
          </tbody></table></div>
      </details></> : null}
  </section>;
}

function reasonKey(row: InventoryAuditEnrichmentRow) {
  return row.reason === "sources_missing" ? `${row.reason}:${(row.missingSources ?? []).join(",")}` : row.reason;
}

function reasonLabel(row: InventoryAuditEnrichmentRow) {
  if (row.reason === "sources_missing" && row.missingSources?.length) {
    if (row.missingSources.length === 2) return "Нет подтверждения в 1С и Excel — проверьте оба источника";
    return row.missingSources[0] === "1c"
      ? "Нет подтверждения в 1С — проверьте загруженную партию и полный номер"
      : "Нет подтверждения в Excel — проверьте файл и полный номер";
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
