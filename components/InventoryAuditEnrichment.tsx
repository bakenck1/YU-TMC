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
        if (response.status === 409) { definitiveFailure = true; setPlan(null); setUncertain(false); throw new Error("Сверка или карточки изменились. Запустите dry-run заново и проверьте изменения."); }
        if (response.status === 401 || response.status === 403) { definitiveFailure = true; setPlan(null); setUncertain(false); throw new Error("Недостаточно прав для обновления карточек."); }
        throw new Error("Не удалось получить результат. Повторите проверку.");
      }
      if (apply) {
        if (!body.result || !Number.isSafeInteger(body.result.updated)) throw new Error("Не удалось получить результат. Повторите проверку.");
        setMessage(`Обновлено карточек: ${body.result.updated}. Без изменений: ${body.result.unchanged}. Пропущено: ${body.result.skipped}. Запустите dry-run заново для обновлённой сводки.`);
        setPlan(null); setUncertain(false); onApplied();
      } else {
        if (body.plan?.runId !== runId || !/^[a-f0-9]{64}$/u.test(body.plan?.planHash ?? "") || !Array.isArray(body.plan?.rows)) throw new Error("Сверка изменилась. Обновите её и повторите проверку.");
        setPlan(body.plan); setUncertain(false);
      }
    } catch (failure) {
      if (current !== generation.current || controller.signal.aborted) return;
      if (apply && !definitiveFailure) setUncertain(true);
      setError(failure instanceof Error ? failure.message : "Не удалось получить результат. Повторите проверку.");
    } finally { if (current === generation.current) setBusy(false); }
  }

  return <section className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4" aria-label="Обновление названий и кодов 1С">
    <h3 className="font-semibold">Названия и коды 1С в карточках ТМЦ</h3>
    <p className="text-sm text-zinc-600">Обновление доступно, когда полный номер или официальный штрихкод подтверждён карточкой, текущим реестром 1С и Excel, а коды 1С совпадают в обоих источниках. Название берётся из 1С. Несовпадения и неоднозначные записи пропускаются; их можно исправить в карточке.</p>
    {blocked ? <p className="text-sm text-amber-800">Для проверки обновлений нужна актуальная сводка. Дождитесь завершения операции и при необходимости запустите dry-run заново.</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || blocked || uncertain} onClick={() => void perform(false)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{busy ? "Проверка…" : "Проверить обновления названий и кодов"}</button>
      {plan?.counts.ready ? <button disabled={busy || blocked} onClick={() => void perform(true)} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">{uncertain ? "Проверить результат обновления" : `Применить ${plan.counts.ready} обновлений`}</button> : null}
    </div>
    {plan ? <><p className="text-sm">Можно обновить: {plan.counts.ready}. Без изменений: {plan.counts.unchanged}. Пропущено: {plan.counts.skipped}.</p>
      <details><summary className="cursor-pointer text-sm text-blue-700">Показать изменения и причины пропуска</summary><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{["ТМЦ", "Новое название из 1С", "Код 1С", "Результат"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{plan.rows.map((row) => <tr key={row.itemId} className="border-t align-top"><td className="p-2"><Link href={`/items/${row.itemId}`} className="text-blue-700">{row.currentName}</Link></td><td className="p-2">{row.nextName ?? "—"}</td><td className="p-2 font-mono">{row.nextCode ?? "—"}</td><td className="p-2">{row.eligible ? row.changed ? "Готово к обновлению" : "Без изменений" : reasonLabel(row.reason)}</td></tr>)}</tbody></table></div></details></> : null}
  </section>;
}

function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    sources_missing: "Нужны подтверждения из текущего реестра 1С и Excel", code_missing: "Не указан код в одном из источников",
    code_conflict: "Коды источников или заполненный код карточки не совпадают",
    source_ambiguous: "Найдено несколько вариантов — требуется проверка", identity_conflict: "Номера или штрихкоды не совпадают",
    item_ineligible: "Карточка архивирована или относится к разделу IT", name_invalid: "Название не подходит для сохранения",
    item_changed: "Карточка изменена после сверки", source_reused: "Запись источника соответствует нескольким карточкам",
    item_not_found: "Карточка больше не существует", identity_missing: "Полный номер или официальный штрихкод не подтверждены",
  };
  return labels[reason] ?? "Требуется ручная проверка номера и кода";
}
