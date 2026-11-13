"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles, ShieldCheck } from "lucide-react";
import type { InventoryAuditEnrichmentRow } from "@/lib/inventory-audit-enrichment";
import { useAppSettings } from "@/components/AppSettingsProvider";

const currentCopy = {
  ru: { title: "Обновление карточек из 1С", subtitle: "Название · код · цена · ответственный", check: "Проверить изменения", checking: "Проверка…", apply: "Применить", updates: "обновлений", retry: "Проверить результат обновления", preview: "Сначала просмотр изменений, затем применение.", ready: "Можно обновить", unchanged: "Без изменений", skipped: "Пропущено", priceChanges: "Изменение цены", ownerChanges: "Изменение ответственного", assetsChecked: "Проверено основных средств", materialsChecked: "МП проверено", cardsChecked: "Карточек проверено", readyToApply: "Готово к обновлению", reasons: "Причины пропуска", show: "Показать изменения и причины пропуска", search: "Поиск по всем карточкам сверки", placeholder: "Название, номер, штрихкод, код 1С или ответственный", shown: "Показано", of: "из", searchScope: "Поиск по всему списку выбранной группы.", which: "Какие обновления показать", readyRows: "Готовые к обновлению", unchangedRows: "Без изменений", skippedRows: "Пропущенные", allRows: "Все карточки", columns: ["ТМЦ", "Новое название", "Источник названия и кода", "Код 1С после обновления", "Результат", "Ответственный", "Цена за единицу, ₸"], matched: "Совпало", was: "Было", codeKept: "Код сохранён без изменения", empty: "В этой группе нет карточек.", more: "Показать ещё 100", sourceAssets: "Основные средства", sourceMaterials: "МП", updated: "Обновлено карточек", resultError: "Не удалось получить результат. Повторите проверку.", stale: "Данные 1С или карточки изменились. Повторите проверку обновлений.", permission: "Недостаточно прав для обновления карточек." },
  kk: { title: "1С деректерімен карточкаларды жаңарту", subtitle: "Атауы · коды · бағасы · жауапты тұлға", check: "Өзгерістерді тексеру", checking: "Тексерілуде…", apply: "Қолдану", updates: "жаңарту", retry: "Жаңарту нәтижесін тексеру", preview: "Алдымен өзгерістерді қарап, содан кейін қолданыңыз.", ready: "Жаңартуға болады", unchanged: "Өзгеріссіз", skipped: "Өткізілді", priceChanges: "Баға өзгерісі", ownerChanges: "Жауапты тұлға өзгерісі", assetsChecked: "НҚ тексерілді", materialsChecked: "МЗ тексерілді", cardsChecked: "Карточкалар тексерілді", readyToApply: "Жаңартуға дайын", reasons: "Өткізу себептері", show: "Өзгерістер мен өткізу себептерін көрсету", search: "Барлық салыстырылған карточкалардан іздеу", placeholder: "Атауы, нөмірі, штрихкоды, 1С коды немесе жауапты тұлға", shown: "Көрсетілді", of: "/", searchScope: "Іздеу таңдалған топтың толық тізімінде жүреді.", which: "Көрсетілетін жаңартулар", readyRows: "Жаңартуға дайын", unchangedRows: "Өзгеріссіз", skippedRows: "Өткізілген", allRows: "Барлық карточкалар", columns: ["Мүлік", "Жаңа атауы", "Атауы мен кодының көзі", "Жаңартудан кейінгі 1С коды", "Нәтиже", "Жауапты тұлға", "Бірлік бағасы, ₸"], matched: "Сәйкес келді", was: "Бұрын", codeKept: "Код өзгеріссіз сақталды", empty: "Бұл топта карточкалар жоқ.", more: "Тағы 100 көрсету", sourceAssets: "НҚ", sourceMaterials: "МЗ", updated: "Жаңартылған карточкалар", resultError: "Нәтиже алынбады. Қайта тексеріңіз.", stale: "1С деректері немесе карточкалар өзгерді. Қайта тексеріңіз.", permission: "Карточкаларды жаңартуға құқық жеткіліксіз." },
  en: { title: "Update cards from 1C", subtitle: "Name · code · price · responsible person", check: "Review changes", checking: "Checking…", apply: "Apply", updates: "updates", retry: "Check update result", preview: "Review changes before applying them.", ready: "Ready to update", unchanged: "Unchanged", skipped: "Skipped", priceChanges: "Price changes", ownerChanges: "Responsible person changes", assetsChecked: "Fixed assets checked", materialsChecked: "Materials checked", cardsChecked: "Cards checked", readyToApply: "Ready to update", reasons: "Reasons skipped", show: "Show changes and reasons skipped", search: "Search all reconciled cards", placeholder: "Name, number, barcode, 1C code or responsible person", shown: "Showing", of: "of", searchScope: "Search covers the whole selected group.", which: "Updates to show", readyRows: "Ready to update", unchangedRows: "Unchanged", skippedRows: "Skipped", allRows: "All cards", columns: ["Item", "New name", "Name and code source", "1C code after update", "Result", "Responsible person", "Unit price, ₸"], matched: "Matched", was: "Previous", codeKept: "Code kept unchanged", empty: "No cards in this group.", more: "Show 100 more", sourceAssets: "Fixed assets", sourceMaterials: "Materials", updated: "Cards updated", resultError: "Could not get the result. Review again.", stale: "1C data or cards changed. Review updates again.", permission: "Insufficient permission to update cards." },
} as const;

type Plan = { runId: string; planHash: string; counts: { ready: number; unchanged: number; skipped: number }; rows: InventoryAuditEnrichmentRow[]; sources?: { fixedAssets: number; materials: number; materialBalances: number; cards: number } };
type Props = { batchId: string; runId: string; blocked: boolean; currentRegistry?: boolean; temporaryOnly?: boolean; decommissioned?: boolean; onApplied(): void };

const decommissionedCopy = {
  ru: { title: "Обновление списанных ТМЦ", subtitle: "Название · цена · пустое назначение ответственного", policy: "Название и цена берутся из подтверждённого совпадения с 1С. Ответственный заполняется, только если он не назначен. Связь с 1С не создаётся, данные в 1С не отправляются.", source: "Источник названия", applyScope: "Будут применены все готовые изменения списанных ТМЦ в этом плане, независимо от поиска и фильтров.", sharedConflict: "Обновление отменено: название нарушает правило общего номера для монитора и системного блока. Проверьте карточки с одинаковым номером и нажмите «Проверить изменения»." },
  kk: { title: "Есептен шығарылған мүлікті жаңарту", subtitle: "Атауы · бағасы · тағайындалмаған жауапты тұлға", policy: "Атауы мен бағасы 1С-тегі расталған сәйкестіктен алынады. Жауапты тұлға тек тағайындалмаған кезде толтырылады. 1С-пен байланыс құрылмайды, 1С-ке деректер жіберілмейді.", source: "Атауының көзі", applyScope: "Іздеу мен сүзгілерге қарамастан, осы жоспардағы есептен шығарылған мүліктің барлық дайын өзгерістері қолданылады.", sharedConflict: "Жаңарту тоқтатылды: атау монитор мен жүйелік блоктың ортақ нөмірі ережесіне сәйкес емес. Бірдей нөмірлі карточкаларды тексеріп, «Өзгерістерді тексеру» түймесін басыңыз." },
  en: { title: "Update written-off items", subtitle: "Name · price · vacant responsible person", policy: "Names and prices come from confirmed 1C matches. A responsible person is assigned only when unassigned. No 1C link is created and no data is sent to 1C.", source: "Name source", applyScope: "All ready changes to written-off items in this plan will be applied, regardless of search and filters.", sharedConflict: "Update cancelled: the name violates the shared-number rule for a monitor and system unit. Check cards with the same number and select Review changes." },
} as const;

const blockedMessage = "Для проверки обновлений нужна актуальная сводка. Дождитесь завершения операции и при необходимости запустите сверку заново.";
const requestErrors = {
  ru: { session: "Сессия истекла. Войдите на сайт заново и повторите проверку.", unavailable: "Сервер временно недоступен. Повторите проверку через минуту.", invalid: "Сервер вернул некорректный ответ. Повторите проверку; если ошибка сохраняется, сообщите администратору." },
  kk: { session: "Сессия аяқталды. Сайтқа қайта кіріп, тексеруді қайталаңыз.", unavailable: "Сервер уақытша қолжетімсіз. Бір минуттан кейін қайталаңыз.", invalid: "Сервер жарамсыз жауап қайтарды. Тексеруді қайталаңыз; қате сақталса, әкімшіге хабарлаңыз." },
  en: { session: "Your session expired. Sign in again and repeat the review.", unavailable: "The server is temporarily unavailable. Try again in a minute.", invalid: "The server returned an invalid response. Retry the review; if it persists, contact the administrator." },
} as const;

export function EnrichmentDescription({ currentRegistry = false, decommissioned = false }: { currentRegistry?: boolean; decommissioned?: boolean }) {
  const { language } = useAppSettings();
  const c = currentCopy[language];
  return <>
    <div className="flex flex-wrap items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-100 text-teal-700"><Sparkles aria-hidden="true" className="h-5 w-5" /></span><div><h3 className="font-semibold text-slate-900">{decommissioned ? decommissionedCopy[language].title : currentRegistry ? c.title : "Названия и коды 1С в карточках ТМЦ"}</h3><p className="mt-0.5 text-xs text-teal-700">{decommissioned ? decommissionedCopy[language].subtitle : currentRegistry ? c.subtitle : "Общий список · основные средства и материальные предметы"}</p></div></div>
  </>;
}

export function InventoryCurrentEnrichment({ blocked = false, temporaryOnly = false, onApplied }: { blocked?: boolean; temporaryOnly?: boolean; onApplied(): void }) {
  const runId = temporaryOnly ? "current-registry-temporary" : "current-registry";
  return <EnrichmentReview key={runId} batchId="" runId={runId} temporaryOnly={temporaryOnly} currentRegistry blocked={blocked} onApplied={onApplied} />;
}

export function InventoryDecommissionedEnrichment() {
  const router = useRouter();
  return <EnrichmentReview batchId="" runId="decommissioned-registry" currentRegistry decommissioned blocked={false} onApplied={() => router.refresh()} />;
}

export default function InventoryAuditEnrichment({ batchId, runId, blocked, onApplied }: Props) {
  return <EnrichmentReview key={`${batchId}:${runId}`} batchId={batchId} runId={runId} blocked={blocked} onApplied={onApplied} />;
}

export function EnrichmentReview({ batchId, runId, blocked, currentRegistry = false, temporaryOnly = false, decommissioned = false, onApplied }: Props) {
  const { language } = useAppSettings();
  const c = currentCopy[language];
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
      const response = await fetch(decommissioned ? "/api/inventory/decommissioned/enrichment" : currentRegistry ? `/api/integrations/1c/enrichment${temporaryOnly ? "?scope=temporary" : ""}` : `/api/integrations/1c/batches/${batchId}/audit/enrichment`, {
        method: apply ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        ...(apply ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: reviewedPlan!.runId, planHash: reviewedPlan!.planHash }) } : {}),
      });
      if (current !== generation.current) return;
      // Authentication and gateway errors can be HTML, including a followed login redirect.
      // Never parse these as JSON or keep an old plan available after a failed preview.
      if (response.status === 401 || response.status === 403 || response.redirected) {
        definitiveFailure = true; setPlan(null); setUncertain(false);
        throw new Error(response.status === 403 ? c.permission : requestErrors[language].session);
      }
      if (response.status >= 500) throw new Error(requestErrors[language].unavailable);
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(requestErrors[language].invalid);
      const body = await response.json().catch(() => { throw new Error(requestErrors[language].invalid); });
      if (current !== generation.current) return;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(requestErrors[language].invalid);
      if (!response.ok) {
        if (response.status === 409) {
          definitiveFailure = true; setPlan(null); setUncertain(false);
          throw new Error(body.error === "inventory_audit_enrichment_shared_number_conflict"
            ? decommissioned ? decommissionedCopy[language].sharedConflict : "Обновление отменено: название нарушает правило общего номера для монитора и системного блока. Проверьте карточки с одинаковым номером и запустите dry-run заново."
            : currentRegistry ? c.stale : "Сверка или карточки изменились. Запустите dry-run заново и проверьте изменения.");
        }
        throw new Error(c.resultError);
      }
      if (apply) {
        if (!body.result || ![body.result.updated, body.result.unchanged, body.result.skipped].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error(c.resultError);
        setMessage(`${c.updated}: ${body.result.updated}. ${c.unchanged}: ${body.result.unchanged}. ${c.skipped}: ${body.result.skipped}.${currentRegistry ? "" : " Запустите dry-run заново для обновлённой сводки."}`);
        setPlan(null); setUncertain(false); onApplied();
      } else {
        if (body.plan?.runId !== runId || !/^[a-f0-9]{64}$/u.test(body.plan?.planHash ?? "") || !Array.isArray(body.plan?.rows)
          || ![body.plan.counts?.ready, body.plan.counts?.unchanged, body.plan.counts?.skipped].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error(requestErrors[language].invalid);
        setPlan(body.plan);
        setRowFilter(body.plan.counts.ready > 0 ? "ready" : body.plan.counts.skipped > 0 ? "skipped" : "unchanged");
        setUncertain(false);
      }
    } catch (failure) {
      if (current !== generation.current || controller.signal.aborted) return;
      if (!apply) setPlan(null);
      if (apply && !definitiveFailure) setUncertain(true);
      setError(failure instanceof TypeError ? requestErrors[language].unavailable : failure instanceof Error ? failure.message : c.resultError);
    } finally { if (current === generation.current) setBusy(false); }
  }

  const loadInitialPreview = useEffectEvent(() => { void perform(false); });
  useEffect(() => {
    if (!decommissioned) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) loadInitialPreview(); });
    return () => { cancelled = true; };
  }, [decommissioned]);

  const skippedReasons = new Map<string, { label: string; count: number }>();
  for (const row of plan?.rows ?? []) {
    if (row.eligible) continue;
    const key = reasonKey(row);
    const group = skippedReasons.get(key) ?? { label: localizedReason(row, language, currentRegistry), count: 0 };
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
  const columns = c.columns.slice(0, currentRegistry ? 7 : 5)
    .filter((_, index) => !decommissioned || index !== 3)
    .map((label, index) => decommissioned && index === 2 ? decommissionedCopy[language].source : label);

  return <section className="space-y-4 rounded-2xl border border-teal-200/70 bg-gradient-to-br from-white via-teal-50/60 to-sky-50/60 p-5 shadow-sm shadow-teal-900/5 sm:p-6" aria-label={decommissioned ? decommissionedCopy[language].title : currentRegistry ? c.title : "Обновление названий и кодов 1С"}>
    <EnrichmentDescription currentRegistry={currentRegistry} decommissioned={decommissioned} />
    {decommissioned ? <p className="text-sm text-slate-600">{decommissionedCopy[language].policy}</p> : null}
    {temporaryOnly ? <p className="text-sm text-slate-600">{{
      ru: "Временный номер создаётся, когда при добавлении не указан официальный номер. Здесь проверяются только такие карточки. Подтверждённое совпадение с 1С даёт статус «Найдено»; временный номер сохраняется. Перед применением проверьте предлагаемые код, название и цену.",
      kk: "Уақытша нөмір ресми нөмір көрсетілмегенде жасалады. Мұнда тек осы карточкалар тексеріледі. Расталған 1С сәйкестігі «Табылды» мәртебесін береді; уақытша нөмір сақталады. Қолданар алдында кодты, атауды және бағаны тексеріңіз.",
      en: "Temporary numbers are created when no official number is supplied. Only those cards are checked here. A confirmed 1C match marks the card as found and preserves its temporary number. Review the proposed code, name and price before applying.",
    }[language]}</p> : null}
    {blocked ? <p className="text-sm text-amber-800">{blockedMessage}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || blocked || uncertain} onClick={() => void perform(false)} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-50"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? c.checking : currentRegistry ? c.check : "Проверить обновления названий и кодов"}</button>
      {plan?.counts.ready ? <button disabled={busy || blocked} onClick={() => void perform(true)} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50">{uncertain ? c.retry : `${c.apply} ${plan.counts.ready} ${c.updates}`}</button> : null}
    </div>
    {decommissioned && plan?.counts.ready ? <p className="text-sm text-slate-600">{decommissionedCopy[language].applyScope}</p> : null}
    {!plan ? <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-teal-600" />{currentRegistry ? c.preview : "Сначала просмотр изменений, затем применение."}</p> : null}
    {plan ? <><p className="text-sm">{c.ready}: {plan.counts.ready}. {c.unchanged}: {plan.counts.unchanged}. {c.skipped}: {plan.counts.skipped}.</p>
      {currentRegistry ? <div className="flex flex-wrap gap-3 text-sm text-teal-800"><span>{c.priceChanges}: {plan.rows.filter(row => row.eligible && row.price?.changed).length}</span><span>{c.ownerChanges}: {plan.rows.filter(row => row.eligible && row.responsibility?.changed).length}</span></div> : null}
      {plan.sources ? <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{[[c.assetsChecked, plan.sources.fixedAssets], [c.materialsChecked, plan.sources.materials], [c.cardsChecked, plan.sources.cards], [c.readyToApply, plan.counts.ready]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/80 bg-white/80 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900">{value}</p></div>)}</div> : null}
      {reasonCounts.length ? <ul aria-label={c.reasons} className="space-y-1 text-sm text-zinc-600">{reasonCounts.map(([key, reason]) => <li key={key}>{reason.label}: <span className="font-medium text-zinc-900">{reason.count}</span></li>)}</ul> : null}
      <details open={currentRegistry || undefined}><summary className="cursor-pointer text-sm font-medium text-teal-800">{c.show}</summary>
        {currentRegistry ? <input aria-label={c.search} value={search} onChange={event => { setSearch(event.target.value); setRowFilter("all"); setVisibleLimit(100); }} placeholder={c.placeholder} className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100" /> : null}
        <select aria-label={c.which} value={rowFilter} onChange={(event) => { setRowFilter(event.target.value); setVisibleLimit(100); }} className="mt-3 max-w-full rounded-lg border px-3 py-2 text-sm">
          <option value="ready">{c.readyRows} ({plan.counts.ready})</option>
          <option value="unchanged">{c.unchangedRows} ({plan.counts.unchanged})</option>
          <option value="skipped">{c.skippedRows} ({plan.counts.skipped})</option>
          <option value="all">{c.allRows} ({plan.rows.length})</option>
          {reasonCounts.length ? <optgroup label={c.reasons}>{reasonCounts.map(([key, reason]) => <option key={key} value={`reason:${key}`}>{reason.label} ({reason.count})</option>)}</optgroup> : null}
        </select>
        {currentRegistry ? <p className="mt-2 text-xs text-slate-500">{c.shown} {visibleRows.length} {c.of} {filteredRows.length}. {c.searchScope}</p> : null}
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-xl border border-teal-100 bg-white/90"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-slate-600"><tr>{columns.map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.itemId} className="border-t border-teal-100 align-top"><td className="p-3"><Link href={`/items/${row.itemId}`} className="text-teal-800">{row.currentName}</Link>{currentRegistry && row.siteNumber ? <p className="mt-1 font-mono text-xs text-slate-500">{row.siteNumber}</p> : null}</td><td className="p-3">{row.eligible ? row.nextName : "—"}</td><td className="p-3">{row.eligible && row.nameSource ? row.nameSource === "materials_api" ? c.sourceMaterials : row.nameSource === "excel" ? "Excel" : currentRegistry ? c.sourceAssets : "1С" : "—"}{currentRegistry && row.identityEvidence ? <p className="mt-1 text-xs text-slate-500">{c.matched}: {row.identityEvidence}</p> : null}</td>{!decommissioned ? <td className="p-3"><span className="font-mono">{row.eligible ? row.nextCode ?? "—" : "—"}</span>{row.eligible && row.currentCode && row.currentCode !== row.nextCode ? <p className="mt-1 text-xs text-zinc-600">{c.was}: {row.currentCode}</p> : null}{row.eligible && row.codeStatus && row.codeStatus !== "confirmed" ? <p className="mt-1 text-xs text-zinc-600">{c.codeKept}: {localizedReason({ ...row, reason: row.codeStatus }, language, currentRegistry)}</p> : null}</td> : null}<td className="p-3">{row.temporaryMatch ? <TemporaryMatchPreview row={row} /> : null}{row.eligible ? row.changed ? c.readyToApply : c.unchanged : localizedReason(row, language, currentRegistry)}{currentRegistry && !row.eligible ? <SourceIdentityDetails row={row} /> : null}</td>{currentRegistry ? <><td className="min-w-64 p-3"><ResponsibilityPreview row={row} /></td><td className="min-w-48 p-3"><PricePreview row={row} /></td></> : null}</tr>)}
            {!visibleRows.length ? <tr><td colSpan={columns.length} className="p-3 text-zinc-500">{c.empty}</td></tr> : null}
          </tbody></table></div>
        {currentRegistry && visibleRows.length < filteredRows.length ? <button type="button" onClick={() => setVisibleLimit(value => value + 100)} className="mt-3 rounded-xl border border-teal-200 bg-white px-4 py-2 text-sm text-teal-800">{c.more}</button> : null}
      </details></> : null}
  </section>;
}

export function TemporaryMatchPreview({ row }: { row: InventoryAuditEnrichmentRow }) {
  const { language } = useAppSettings();
  const match = row.temporaryMatch;
  if (!match) return null;
  const labels = {
    ru: { found: "Найдено в 1С", possible: "Нужно сверить номер", missing: "Не найдено в 1С" },
    kk: { found: "1С-тен табылды", possible: "Нөмірді тексеру керек", missing: "1С-тен табылмады" },
    en: { found: "Found in 1C", possible: "Check the number", missing: "Not found in 1C" },
  }[language];
  return <p className={`mb-1 font-medium ${match.found ? "text-emerald-700" : "text-amber-700"}`}>{match.found ? labels.found : match.category === "possible" ? labels.possible : labels.missing}</p>;
}

export function SourceIdentityDetails({ row }: { row: InventoryAuditEnrichmentRow }) {
  const { language } = useAppSettings();
  if (!row.sourceDetails?.length) return null;
  const labels = { ru: ["Сравнить номера и названия", "Номер в поле 1С", "Штрихкод"], kk: ["Нөмірлер мен атауларды салыстыру", "1С өрісіндегі нөмір", "Штрихкод"], en: ["Compare numbers and names", "Number in 1C field", "Barcode"] }[language];
  return <details className="mt-2 min-w-64 text-xs text-slate-600"><summary className="cursor-pointer text-teal-800">{labels[0]}</summary><div className="mt-2 space-y-3">{row.sourceDetails.map((source, index) => <div key={index}><p className="font-medium">{source.kind === "ОС" ? currentCopy[language].sourceAssets : source.kind}: {source.name}</p><p className="mt-1">{labels[1]}: <span className="font-mono">{source.inventoryNumber ?? "—"}</span></p><p>{labels[2]}: <span className="font-mono">{source.barcode ?? "—"}</span></p></div>)}</div></details>;
}

export function PricePreview({ row }: { row: InventoryAuditEnrichmentRow }) {
  const { language, locale } = useAppSettings();
  const price = row.price;
  const labels = {
    ru: { ready: "Будет обновлена", unchanged: "Без изменений", missing: "В 1С цена не указана", invalid: "В 1С некорректная цена", ambiguous: "В 1С нет однозначной цены за единицу", unconfirmed: "Нет подтверждённого совпадения" },
    kk: { ready: "Жаңартылады", unchanged: "Өзгеріссіз", missing: "1С-те баға көрсетілмеген", invalid: "1С-тегі баға қате", ambiguous: "1С-те бірлік бағасы бірмәнді емес", unconfirmed: "Расталған сәйкестік жоқ" },
    en: { ready: "Will be updated", unchanged: "Unchanged", missing: "No price in 1C", invalid: "Invalid price in 1C", ambiguous: "No unambiguous unit price in 1C", unconfirmed: "No confirmed match" },
  }[language];
  if (!price) return <>{labels.unchanged}</>;
  const source = {
    ru: { os_initial_cost: "Основные средства · первоначальная стоимость", material_unit_price: "МП · цена за единицу" },
    kk: { os_initial_cost: "НҚ · бастапқы құн", material_unit_price: "МЗ · бірлік бағасы" },
    en: { os_initial_cost: "Fixed assets · initial cost", material_unit_price: "Materials · unit price" },
  }[language];
  const format = (value: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(value));
  return <><p className={price.changed ? "font-medium text-teal-800" : "text-slate-600"}>{format(price.nextUnitPrice)} ₸</p>
    {price.changed ? <p className="mt-1 text-xs text-slate-500">{currentCopy[language].was}: {format(price.currentUnitPrice)} ₸</p> : null}
    {price.source ? <p className="mt-1 text-xs text-slate-500">{source[price.source]}</p> : null}
    <p className="mt-1 text-xs text-slate-500">{labels[price.status]}</p></>;
}

export function ResponsibilityPreview({ row }: { row: InventoryAuditEnrichmentRow }) {
  const { language } = useAppSettings();
  const proposal = row.responsibility;
  const labels: Record<typeof language, Record<NonNullable<InventoryAuditEnrichmentRow["responsibility"]>["status"], string>> = {
    ru: { ready: "Будет назначен", unchanged: "Уже назначен", not_allowed: "Автоматическое назначение отключено", ambiguous: "Ответственный в 1С неоднозначен", user_missing: "Сотрудник не найден на сайте", user_ambiguous: "На сайте несколько сотрудников с таким именем", pending_transfer: "Есть незавершённая передача", unavailable: "Назначение сейчас недоступно", unconfirmed: "Нет подтверждённого совпадения" },
    kk: { ready: "Тағайындалады", unchanged: "Тағайындалған", not_allowed: "Автоматты тағайындау өшірілген", ambiguous: "1С-тегі жауапты тұлға анық емес", user_missing: "Қызметкер сайттан табылмады", user_ambiguous: "Сайтта осы аттас бірнеше қызметкер бар", pending_transfer: "Аяқталмаған беру бар", unavailable: "Қазір тағайындау мүмкін емес", unconfirmed: "Расталған сәйкестік жоқ" },
    en: { ready: "Will be assigned", unchanged: "Already assigned", not_allowed: "Automatic assignment disabled", ambiguous: "Responsible person in 1C is ambiguous", user_missing: "Employee not found on site", user_ambiguous: "Multiple employees share this name", pending_transfer: "Pending transfer", unavailable: "Assignment unavailable", unconfirmed: "No confirmed match" },
  };
  const unassigned = { ru: "Не назначен", kk: "Тағайындалмаған", en: "Unassigned" }[language];
  if (!proposal) return <>{currentCopy[language].unchanged}</>;
  return <><p className={proposal.changed ? "font-medium text-teal-800" : "text-slate-600"}>{proposal.changed ? proposal.nextName : proposal.currentName ?? unassigned}</p>
    {proposal.changed ? <p className="mt-1 text-xs text-slate-500">{currentCopy[language].was}: {proposal.currentName ?? unassigned}</p> : null}
    {proposal.sourceName ? <p className="mt-1 text-xs text-slate-500">1С: {proposal.sourceName}</p> : null}
    <p className="mt-1 text-xs text-slate-500">{labels[language][proposal.status]}</p></>;
}

function reasonKey(row: InventoryAuditEnrichmentRow) {
  return row.reason === "sources_missing" ? `${row.reason}:${(row.missingSources ?? []).join(",")}` : row.reason;
}

function localizedReason(row: InventoryAuditEnrichmentRow, language: "ru" | "kk" | "en", currentRegistry: boolean) {
  if (language === "ru") return reasonLabel(row, currentRegistry);
  const labels = {
    kk: { sources_missing: "1С-тен расталған сәйкестік жоқ — толық нөмірді не штрихкодты тексеріңіз", shared_number_conflict: "Монитор мен жүйелік блоктың ортақ нөмірі қайшы келеді", code_missing: "1С жазбасында код жоқ", code_invalid: "1С коды жарамсыз", code_conflict: "1С пен карточка кодтары сәйкес емес", source_ambiguous: "Бірнеше 1С жазбасы сәйкес келеді", identity_conflict: "Карточка мен 1С нөмірлері немесе штрихкодтары қайшы", item_ineligible: "Карточка мұрағатта немесе IT бөлімінде", name_invalid: "Атауын сақтау мүмкін емес", item_changed: "Карточка салыстырудан кейін өзгерді", source_reused: "1С жазбасы бірнеше карточкаға сәйкес келеді", item_not_found: "Карточка енді жоқ", identity_missing: "Толық нөмір не ресми штрихкод расталмады" },
    en: { sources_missing: "No confirmed 1C match — check the full number or barcode", shared_number_conflict: "Shared monitor and system-unit number conflicts", code_missing: "No code in the 1C record", code_invalid: "Invalid 1C code", code_conflict: "1C and card codes conflict", source_ambiguous: "Several 1C records match", identity_conflict: "Card and 1C numbers or barcodes conflict", item_ineligible: "Card is archived or belongs to IT", name_invalid: "Name cannot be saved", item_changed: "Card changed after reconciliation", source_reused: "1C record matches multiple cards", item_not_found: "Card no longer exists", identity_missing: "Full number or official barcode not confirmed" },
  }[language] as Record<string, string>;
  return labels[row.reason] ?? (language === "kk" ? "Нөмір мен кодты қолмен тексеру керек" : "Number and code require manual review");
}

function reasonLabel(row: InventoryAuditEnrichmentRow, currentRegistry = false) {
  const label = legacyReasonLabel(row);
  return currentRegistry ? label.replaceAll("материалах API 1С", "материальных предметах 1С").replaceAll("партию и полный номер", "реестр и полный номер") : label;
}

function legacyReasonLabel(row: InventoryAuditEnrichmentRow) {
  if (row.reason === "sources_missing" && row.missingSources?.length) {
    if (row.missingSources.length === 2) return "Нет подтверждения в основных средствах и материалах API 1С — проверьте оба источника";
    return row.missingSources[0] === "1c"
      ? "Нет подтверждения в основных средствах 1С — проверьте партию и полный номер"
      : "Нет подтверждения в материалах API 1С — проверьте реестр и полный номер";
  }
  const labels: Record<string, string> = {
    shared_number_conflict: "Новое название нарушает правило общего номера для монитора и системного блока — проверьте обе карточки, включая архив",
    sources_missing: "Нет подтверждения в источниках — проверьте полные номера", code_missing: "Код не указан в выбранной записи источника",
    code_invalid: "Код выбранной записи не подходит для сохранения",
    code_conflict: "Коды источников или карточки не совпадают — проверьте значения",
    source_ambiguous: "Найдено несколько вариантов — проверьте записи источников", identity_conflict: "Номер или штрихкод в карточке, полях и названии 1С различается — обновление пропущено",
    item_ineligible: "Карточка архивирована или относится к разделу IT", name_invalid: "Название не подходит для сохранения",
    item_changed: "Карточка изменена после сверки", source_reused: "Запись источника соответствует нескольким карточкам",
    item_not_found: "Карточка больше не существует", identity_missing: "Полный номер или официальный штрихкод не подтверждены",
  };
  return labels[row.reason] ?? "Требуется ручная проверка номера и кода";
}
