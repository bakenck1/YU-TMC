"use client";

import Link from "next/link";
import { oneCInventoryPresence, oneCMissingInventoryMessage, ONE_C_PRESENCE_LABELS } from "@/lib/one-c-inventory-presence";
import { useRef, useState } from "react";
import type { ButtonHTMLAttributes } from "react";
import InventorySourceAuditPanel, { type AuditPage } from "@/components/InventorySourceAuditPanel";
import MaterialSnapshotUploadPanel from "@/components/MaterialSnapshotUploadPanel";
import type { MaterialSnapshotMetadata } from "@/lib/server/material-snapshot-service";

type Row = Record<string, unknown>;
type Page = { data: Row[]; page: number; pageSize: number; total: number };
type Reason = "guid" | "code" | "inventory_number" | "barcode";
type Candidate = { id: string; name: string; inventoryNumber: string; oneCCode: string | null; status: string; version: number; matchedBy: Reason[] };
type RowFilters = { pageSize?: number; reviewState?: string; proposedAction?: string; match?: "" | "active" | "missing"; search?: string };

export default function OneCReconciliationManager({ initialBatches, initialSnapshot }: { initialBatches: Page; initialSnapshot?: MaterialSnapshotMetadata | null }) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [batches, setBatches] = useState(initialBatches.data);
  const [rows, setRows] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [proposedAction, setProposedAction] = useState("");
  const [matchFilter, setMatchFilter] = useState<"" | "active" | "missing">("");
  const [pageSize, setPageSize] = useState(50);
  const [candidateRowId, setCandidateRowId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState(initialSnapshot ?? null);
  const context = useRef(0);
  const rowRequest = useRef(0);
  const auditRequest = useRef(0);
  const candidateRequest = useRef(0);
  const mutating = useRef(false);

  function invalidateReads() {
    rowRequest.current++; auditRequest.current++; candidateRequest.current++;
    setAuditBusy(false); setCandidateBusy(false);
    setCandidateRowId(null); setCandidates([]);
  }

  function finishRead() { if (!mutating.current) setBusy(false); }

  async function refreshBatch(batch: Row) {
    const epoch = context.current;
    const value = await request(`/api/integrations/1c/batches/${batch.id}`);
    if (epoch !== context.current) throw new Error("superseded_request");
    const current = value.batch as Row;
    if (!current || current.id !== batch.id || !Number.isInteger(current.version)) throw new Error("invalid_batch_response");
    setSelected(current);
    setBatches((previous) => previous.map((entry) => entry.id === current.id ? current : entry));
    return current;
  }

  async function loadAudit(batch: Row, page: number, filters: { search?: string; result?: string; source?: string; pageSize?: number } = {}) {
    const sequence = ++auditRequest.current;
    const params = new URLSearchParams({ page: String(page), pageSize: String(filters.pageSize ?? 50) });
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.result) params.set("result", filters.result);
    if (filters.source) params.set("source", filters.source);
    setAuditBusy(true);
    try {
      const value = await request(`/api/integrations/1c/batches/${batch.id}/audit?${params}`);
      if (sequence === auditRequest.current) setAudit(value.audit as AuditPage);
    } catch (cause) { if (sequence === auditRequest.current) throw cause; }
    finally { if (sequence === auditRequest.current) setAuditBusy(false); }
  }

  async function loadRows(batch: Row, page: number, overrides: RowFilters = {}) {
    const sequence = ++rowRequest.current;
    const params = new URLSearchParams({ page: String(page), pageSize: String(overrides.pageSize ?? pageSize) });
    if ((overrides.search ?? search).trim()) params.set("search", (overrides.search ?? search).trim());
    const state = overrides.reviewState ?? reviewState;
    const action = overrides.proposedAction ?? proposedAction;
    if (state) params.set("reviewState", state);
    if (action) params.set("proposedAction", action);
    const match = overrides.match ?? matchFilter;
    if (match) params.set("match", match);
    try {
      const value = await request(`/api/integrations/1c/batches/${batch.id}/rows?${params}`);
      if (sequence === rowRequest.current) setRows(value.rows as Page);
    } catch (cause) { if (sequence === rowRequest.current) throw cause; }
  }

  async function queryRows(batch: Row, page: number, filters: RowFilters = {}, message = "Не удалось загрузить строки сверки") {
    if (mutating.current) return;
    const epoch = context.current;
    setBusy(true);
    const pending = loadRows(batch, page, filters);
    const sequence = rowRequest.current;
    try { await pending; }
    catch { if (epoch === context.current && sequence === rowRequest.current) setError(message); }
    finally { if (epoch === context.current && sequence === rowRequest.current) finishRead(); }
  }

  async function openBatch(batch: Row, afterDecision = false) {
    if (mutating.current && !afterDecision) return;
    const epoch = ++context.current;
    invalidateReads();
    setSelected(null); setRows(null); setAudit(null); setBusy(true); setError(null); setCandidateRowId(null); setCandidates([]); setMatchFilter(""); setReviewState(""); setProposedAction(""); setSearch("");
    try {
      const current = await refreshBatch(batch);
      await loadRows(current, 1, { match: "", reviewState: "", proposedAction: "", search: "" });
      if (epoch !== context.current) return;
      if ((current.summary as Row | undefined)?.inventoryAudit) await loadAudit(current, 1);
    } catch { if (epoch === context.current) setError("Не удалось загрузить строки сверки"); }
    finally { if (epoch === context.current) finishRead(); }
  }

  async function analyze() {
    if (!selected || mutating.current) return;
    mutating.current = true;
    context.current++;
    invalidateReads();
    setBusy(true); setError(null);
    let analysisCompleted = false;
    let analysisAttempted = false;
    try {
      const current = await refreshBatch(selected);
      analysisAttempted = true;
      const result = await request(`/api/integrations/1c/batches/${current.id}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: current.version }) });
      if (!result.analysis || typeof result.analysis !== "object" || Array.isArray(result.analysis)) throw new Error("invalid_analysis_response");
      analysisCompleted = true;
      // The previous audit belongs to an earlier version and must not accompany the new result.
      setAudit(null); setRows(null);
      const batch = await refreshBatch(current);
      setReviewState(""); setProposedAction(""); setMatchFilter("active"); setSearch("");
      await loadRows(batch, 1, { reviewState: "", proposedAction: "", match: "active", search: "" });
      if ((batch.summary as Row | undefined)?.inventoryAudit) await loadAudit(batch, 1);
    } catch (cause) {
      // A generic 503 can also mean that PostgreSQL committed but its COMMIT acknowledgment was lost.
      const uncertain = analysisAttempted && !analysisCompleted && (
        !(cause instanceof ServerResponseError) || cause.message === "one_c_reconciliation_unavailable"
      );
      setError(analysisCompleted
        ? "Dry-run выполнен, но результаты не удалось загрузить. Откройте сверку заново."
        : uncertain
          ? "Ответ на запуск dry-run не получен. Проверяется текущее состояние партии; повторный запуск не отправлен."
          : analysisErrorMessage(cause));
      if (uncertain || (cause instanceof Error && cause.message === "batch_version_conflict")) {
        setAudit(null); setRows(null);
        await (async () => {
          const current = await refreshBatch(selected);
          await loadRows(current, 1);
          if ((current.summary as Row | undefined)?.inventoryAudit) await loadAudit(current, 1);
          if (uncertain) setError("Ответ на запуск dry-run не получен. Загружено текущее состояние партии; проверьте результаты перед повторным запуском.");
        })().catch(() => {
          if (uncertain) setError("Ответ на запуск dry-run не получен, текущее состояние загрузить не удалось. Откройте сверку заново перед повторным запуском.");
        });
      }
    } finally { mutating.current = false; setBusy(false); }
  }

  async function decide(row: Row, decision: Row) {
    if (!selected || mutating.current) return;
    mutating.current = true;
    context.current++; invalidateReads();
    setBusy(true); setError(null);
    try {
      await request(`/api/integrations/1c/batches/${selected.id}/rows/${row.external_id}/decision`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: selected.version, decision }) });
      const updated = { ...selected, version: Number(selected.version) + 1 };
      setCandidateRowId(null); setCandidates([]);
      await openBatch(updated, true);
    } catch { setError("Решение не сохранено: кандидат мог измениться или уже связан с другим GUID."); }
    finally { mutating.current = false; setBusy(false); }
  }

  async function showCandidates(row: Row) {
    if (!selected || mutating.current) return;
    const sequence = ++candidateRequest.current;
    const externalId = String(row.external_id);
    if (candidateRowId === externalId) { setCandidateRowId(null); setCandidates([]); return; }
    setCandidateBusy(true); setError(null);
    try {
      const value = await request(`/api/integrations/1c/batches/${selected.id}/rows/${externalId}/candidates`);
      if (sequence === candidateRequest.current) { setCandidates(value.candidates as Candidate[]); setCandidateRowId(externalId); }
    } catch { if (sequence === candidateRequest.current) setError("Не удалось найти кандидатов по GUID, коду 1С, инвентарному номеру и штрихкоду."); }
    finally { if (sequence === candidateRequest.current) setCandidateBusy(false); }
  }

  async function reloadRows() {
    if (!selected || mutating.current) return;
    await queryRows(selected, 1, {}, "Поиск не выполнен");
  }

  async function go(page: number) {
    if (!selected || mutating.current || !rows || page < 1 || page > Math.ceil(rows.total / rows.pageSize)) return;
    await queryRows(selected, page, {}, "Не удалось открыть страницу");
  }

  async function transition(kind: "approve" | "publish") {
    if (!selected || mutating.current) return;
    const plan = (selected.summary as Row | undefined)?.plan as Row | undefined;
    if (typeof plan?.hash !== "string") { setError("Сначала выполните анализ."); return; }
    mutating.current = true;
    context.current++; invalidateReads();
    setBusy(true); setError(null);
    try {
      await request(`/api/integrations/1c/batches/${selected.id}/${kind}`, { method: "POST", headers: { "content-type": "application/json", ...(kind === "publish" ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: JSON.stringify({ version: selected.version, planHash: plan.hash }) });
      window.location.reload();
    } catch { setError(kind === "approve" ? "Выгрузка не готова к утверждению." : "Публикация отклонена; повторите dry-run."); }
    finally { mutating.current = false; setBusy(false); }
  }

  const massBlocked = ((selected?.summary as Row | undefined)?.massPublicationBlocked === true) || (selected?.request_id == null && selected?.source_filename == null);
  const summary = selected?.summary as Row | undefined;
  const hasAnalysis = typeof summary?.identifierMatched === "number";
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-zinc-900">Сверка основных средств 1С</h1><p className="mt-1 text-sm text-zinc-500">Найдите шкафы и другие ТМЦ, которые есть в 1С, но не найдены в Inventory.</p></div>
      {selected ? <div className="flex flex-wrap gap-2"><a href={`/api/integrations/1c/batches/${selected.id}/export`} className="rounded-xl border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700">Скачать Excel ({String(selected.received_count)})</a><button disabled={busy} onClick={() => void analyze()} className="rounded-xl bg-[#002060] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Запустить dry-run</button>{selected.state === "review_required" && !massBlocked ? <button disabled={busy} onClick={() => void transition("approve")} className="rounded-xl border px-4 py-2 text-sm">Утвердить</button> : null}{selected.state === "approved" && !massBlocked ? <button disabled={busy} onClick={() => void transition("publish")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm text-white">Опубликовать</button> : null}</div> : null}
    </header>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    <MaterialSnapshotUploadPanel initialSnapshot={initialSnapshot} onUploaded={(snapshot) => { auditRequest.current++; setAuditBusy(false); setActiveSnapshot(snapshot); setAudit(null); setError(null); }} />
    {selected && massBlocked ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Это исторический снимок без исходного XML. Его можно просматривать, искать и выгружать в Excel, но утверждение и публикация заблокированы. Для публикации используйте новый полный XML-пакет от 1С.</p> : null}
    <p className="text-sm text-zinc-600">Откройте нужную выгрузку 1С → запустите dry-run → нажмите «Показать отсутствующие» или скачайте Excel. После изменения Inventory запустите сверку заново.</p>
    <BatchTable batches={batches} onOpen={openBatch} disabled={busy}/>
    {selected ? <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Card label="Всего" value={selected.received_count}/><Card label="Создано во входящем реестре" value={selected.created_count}/><Card label="Обновлено" value={selected.updated_count}/><Card label="Без изменений" value={selected.unchanged_count}/></div>
      {hasAnalysis ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><h2 className="font-semibold text-emerald-900">Результат dry-run</h2><p className="mt-1 text-sm text-emerald-800">Точные совпадения с ТМЦ: {String(summary?.identifierMatched)}. Из них действующие в 1С и активные на сайте: {String(summary?.activeMatched)}. Конфликты: {String(summary?.conflicts)}. Название для поиска совпадений не используется.</p><button type="button" disabled={busy} className="mt-3 rounded-lg border border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-900" onClick={() => { if (mutating.current) return; setMatchFilter("active"); setReviewState(""); setProposedAction(""); void queryRows(selected, 1, { match: "active", reviewState: "", proposedAction: "" }, "Не удалось загрузить активные совпадения"); }}>Показать активные совпадения</button></div> : null}
      {hasAnalysis ? <section aria-label="Отсутствующие ТМЦ" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="font-semibold text-amber-900">Нет в Inventory: {typeof summary?.missingInventory === "number" ? String(summary.missingInventory) : "обновите сверку"}</h2>
        <p className="mt-1 text-sm text-amber-900">Действующие ТМЦ из выбранной выгрузки 1С, для которых не найдено совпадений по идентификаторам. Возможные совпадения и конфликты вынесены в Excel на лист «Требует проверки». Подразделение и ответственный из 1С помогут найти предмет.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="rounded-lg border border-amber-700 px-3 py-2 text-sm font-medium text-amber-900" onClick={() => { if (mutating.current) return; setMatchFilter("missing"); setReviewState(""); setProposedAction(""); setSearch(""); void queryRows(selected, 1, { match: "missing", reviewState: "", proposedAction: "", search: "" }, "Не удалось загрузить отсутствующие ТМЦ"); }}>Показать отсутствующие</button>
          <a href={`/api/integrations/1c/batches/${selected.id}/export?scope=missing`} className="rounded-lg bg-amber-800 px-3 py-2 text-sm font-medium text-white">Скачать отсутствующие в Excel</a>
        </div>
      </section> : null}
      {audit ? <InventorySourceAuditPanel key={audit.run.id} batchId={String(selected.id)} audit={audit} activeSnapshotSha256={activeSnapshot?.sha256} busy={auditBusy || busy} onLoad={(page, filters) => { if (mutating.current) return; void loadAudit(selected, page, filters).catch(() => setError("Не удалось загрузить сводку ТМЦ.")); }} /> : null}
      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/5 p-4"><div><h2 className="font-semibold">Строки сверки</h2><p className="text-xs text-zinc-500">{rows ? `Показано ${rows.total ? (rows.page - 1) * rows.pageSize + 1 : 0}–${Math.min(rows.page * rows.pageSize, rows.total)} из ${rows.total}` : "Загрузка списка"}</p></div>
          <form onSubmit={(event) => { event.preventDefault(); void reloadRows(); }} className="flex flex-wrap gap-2"><input aria-label="Поиск по строкам" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-64 rounded-lg border border-zinc-200 px-3 py-2" placeholder="GUID, код, номер, barcode, название"/><Filter disabled={busy} value={matchFilter} label="Совпадения" onChange={(value) => { if (mutating.current) return; const match = value as "" | "active" | "missing"; setMatchFilter(match); void queryRows(selected, 1, { match }, "Фильтр не применён"); }} options={[["", "Все строки"], ["active", "Активные совпадения"], ...(hasAnalysis ? [["missing", "Нет в Inventory"]] : [])]}/><Filter disabled={busy} value={reviewState} label="Статус проверки" onChange={(value) => { if (mutating.current) return; setReviewState(value); void queryRows(selected, 1, { reviewState: value }, "Фильтр не применён"); }} options={[["", "Все статусы"], ["matched", "Найдено совпадение"], ["blocked", "Заблокировано"], ["conflict", "Конфликт"], ["excluded", "Исключено"], ["approved", "Подтверждено"], ["published", "Опубликовано"]]}/><Filter disabled={busy} value={proposedAction} label="Действие" onChange={(value) => { if (mutating.current) return; setProposedAction(value); void queryRows(selected, 1, { proposedAction: value }, "Фильтр не применён"); }} options={[["", "Все действия"], ["link", "Связать"], ["create", "Создать"], ["manual_review", "Ручная проверка"], ["exclude", "Исключить"]]}/><select disabled={busy} aria-label="Строк на странице" value={pageSize} onChange={(event) => { if (mutating.current) return; const value = Number(event.target.value); setPageSize(value); void queryRows(selected, 1, { pageSize: value }); }} className="rounded-lg border border-zinc-200 px-3 py-2"><option value="50">50 строк</option><option value="100">100 строк</option></select><button disabled={busy} className="rounded-lg border px-3 py-2">Найти</button></form>
        </div>
        {busy ? <p className="p-6 text-sm text-zinc-500">Загрузка…</p> : <><div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-zinc-50"><tr><th className="p-3">Проверка</th><th className="p-3">GUID / код</th><th className="p-3">Инв. номер / barcode</th><th className="p-3">Название</th><th className="p-3">Подразделение / ответственный</th><th className="p-3">Остаточная стоимость</th><th className="p-3">Найденный предмет</th><th className="p-3">Решение</th></tr></thead><tbody>{rows?.data.map((row) => <AssetRow key={String(row.external_id)} row={row} open={candidateRowId === String(row.external_id)} candidates={candidates} candidateBusy={candidateBusy} show={showCandidates} decide={decide}/>)}</tbody></table></div>{rows?.total === 0 ? <p className="p-6 text-center text-sm text-zinc-500">{matchFilter === "missing" ? "По выбранным фильтрам отсутствующих ТМЦ не найдено. Неоднозначные записи проверьте в Excel." : "По выбранным фильтрам строк нет."}</p> : null}{rows && rows.total > rows.pageSize ? <div className="flex items-center justify-between border-t p-4 text-sm"><span>Страница {rows.page} из {Math.ceil(rows.total / rows.pageSize)}</span><div className="flex gap-2"><PageButton disabled={rows.page === 1} onClick={() => void go(1)}>Первая</PageButton><PageButton disabled={rows.page === 1} onClick={() => void go(rows.page - 1)}>Назад</PageButton><PageButton disabled={rows.page >= Math.ceil(rows.total / rows.pageSize)} onClick={() => void go(rows.page + 1)}>Далее</PageButton><PageButton disabled={rows.page >= Math.ceil(rows.total / rows.pageSize)} onClick={() => void go(Math.ceil(rows.total / rows.pageSize))}>Последняя</PageButton></div></div> : null}</>}
      </div>
    </section> : null}
  </div>;
}

export function BatchTable({ batches, onOpen, disabled = false }: { batches: Row[]; onOpen(batch: Row): Promise<void>; disabled?: boolean }) { return <section aria-label="Выгрузки 1С" className="overflow-hidden rounded-2xl border border-black/5 bg-white"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-zinc-50 text-zinc-500"><tr><th className="p-3">Получена</th><th className="p-3">Файл / SHA-256</th><th className="p-3">Строки</th><th className="p-3">Статус</th><th className="p-3">Действие</th></tr></thead><tbody>{batches.map((batch) => <tr key={String(batch.id)} className="border-t"><td className="p-3">{formatDate(batch.received_at)}</td><td className="p-3"><div>{String(batch.source_filename ?? "Без имени")}</div><code className="text-xs text-zinc-500">{String(batch.source_sha256).slice(0, 16)}…</code></td><td className="p-3">{String(batch.received_count)}</td><td className="p-3"><Status value={String(batch.state)}/></td><td className="p-3"><button disabled={disabled} onClick={() => void onOpen(batch)} className="font-medium text-blue-700 hover:underline">Открыть сверку</button></td></tr>)}</tbody></table></div>{!batches.length ? <p className="p-6 text-center text-sm text-zinc-500">Выгрузок пока нет</p> : null}</section>; }

export function AssetRow({ row, open, candidates, candidateBusy, show, decide }: { row: Row; open: boolean; candidates: Candidate[]; candidateBusy: boolean; show(row: Row): Promise<void>; decide(row: Row, decision: Row): Promise<void> }) {
  const payload = row.payload as Row;
  return <tr className="border-t align-top"><td className="p-3"><div className={oneCInventoryPresence(row) === "missing" ? "mb-2 font-medium text-amber-800" : "mb-2 text-zinc-600"}>{oneCInventoryPresence(row) === "missing" ? oneCMissingInventoryMessage(String(payload.name ?? "")) : ONE_C_PRESENCE_LABELS[oneCInventoryPresence(row)]}</div><Status value={String(row.review_state)}/></td><td className="p-3"><code>{String(row.external_id)}</code><div>{String(payload.code ?? "—")}</div></td><td className="p-3"><div>{String(payload.inventoryNumber ?? "Не передан")}</div><div className="text-zinc-500">{payload.barcode ? String(payload.barcode) : "Штрихкод 1С не передан"}</div></td><td className="p-3">{String(payload.name)}</td><td className="p-3"><div>{String(payload.location ?? "—")}</div><div className="text-zinc-500">{String(payload.responsibleName ?? "Ответственный не указан")}</div></td><td className="p-3">{payload.residualCost === null ? "Не передана" : String(payload.residualCost)}</td><td className="p-3">{row.matched_item_id ? <Link className="text-blue-700 hover:underline" href={`/items/${row.matched_item_id}`}>{String(row.matched_item_name ?? row.matched_item_id)}</Link> : "—"}{row.matched_item_id ? <div className="text-emerald-700">Совпало: {matchLabels(String(row.match_method ?? ""))}</div> : null}{row.matched_item_status ? <div>Статус сайта: {STATUS[String(row.matched_item_status)] ?? String(row.matched_item_status)}</div> : null}<div>{Array.isArray(row.issues) && row.issues.length ? row.issues.map((issue) => issueLabel(String((issue as Row).code))).join(", ") : "Нет проблем"}</div></td><td className="space-y-2 p-3"><button className="block font-medium text-blue-700 hover:underline" onClick={() => void show(row)}>{open ? "Закрыть кандидатов" : "Выбрать другой предмет"}</button>{open ? <CandidateList row={row} candidates={candidates} busy={candidateBusy} decide={decide}/> : null}<button className="block text-zinc-600 hover:underline" onClick={() => void decide(row, { exclude: true })}>Исключить строку</button></td></tr>;
}

export function CandidateList({ row, candidates, busy, decide }: { row: Row; candidates: Candidate[]; busy: boolean; decide(row: Row, decision: Row): Promise<void> }) { return <div className="min-w-72 space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-2">{busy ? <p>Поиск…</p> : candidates.length ? candidates.map((candidate) => <div key={candidate.id} className="rounded-lg bg-white p-2 shadow-sm"><Link className="font-medium text-blue-800 hover:underline" href={`/items/${candidate.id}`}>{candidate.name}</Link><div className="mt-1">Инв. №: {candidate.inventoryNumber || "—"}</div><div>Код 1С: {candidate.oneCCode || "—"}</div><div>Статус: {STATUS[candidate.status] ?? candidate.status}</div><div className="mt-1 flex flex-wrap gap-1">{candidate.matchedBy.map((reason) => <span key={reason} className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">{reasonLabel(reason)}</span>)}</div><button className="mt-2 rounded-lg bg-[#002060] px-3 py-1.5 font-medium text-white" onClick={() => void decide(row, { confirmLink: true, itemId: candidate.id, expectedItemVersion: candidate.version })}>Связать с этим предметом</button></div>) : <p className="text-zinc-600">Точных совпадений по GUID, коду 1С, инвентарному номеру и штрихкоду нет.</p>}</div>; }

export function Filter({ value, label, onChange, options, disabled = false }: { disabled?: boolean; value: string; label: string; onChange(value: string): void; options: string[][] }) { return <select disabled={disabled} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-zinc-200 px-3 py-2">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>; }
export function PageButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button type="button" {...props} className="rounded-lg border px-3 py-2 disabled:opacity-40">{children}</button>; }
class ServerResponseError extends Error {}
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: "same-origin" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as Row | null;
    // An unparseable response may have come from a proxy after a committed request.
    if (typeof body?.error !== "string") throw new Error("invalid_error_response");
    throw new ServerResponseError(body.error);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_response");
  return value as Row;
}
function analysisErrorMessage(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "batch_version_conflict") return "Партия изменилась или её статус не допускает анализ. Проверьте статус партии; при необходимости откройте сверку заново и повторите dry-run.";
  if (code.includes("material_snapshot")) return "Снимок Excel не загружен или повреждён. Dry-run не выполнен; загрузите файл заново.";
  if (code === "one_c_registry_empty") return "Текущий реестр 1С пуст. Dry-run не выполнен.";
  if (code === "one_c_analysis_timeout") return "Сервер не успел выполнить dry-run. Предыдущая сводка сохранена. Обратитесь к администратору сервера.";
  if (code === "one_c_analysis_schema_outdated") return "Схема базы данных не обновлена. Администратору сервера нужно применить миграции и повторить dry-run.";
  if (code === "unauthorized") return "Сессия завершена. Войдите в систему заново.";
  if (code === "forbidden") return "Для запуска dry-run нужны права администратора.";
  return "Dry-run не выполнен. Предыдущая сводка сохранена. Проверьте доступность сервера и повторите запуск.";
}
function formatDate(value: unknown) { const date = new Date(String(value)); return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date); }
export function Card({ label, value }: { label: string; value: unknown }) { return <div className="rounded-2xl border border-black/5 bg-white p-4"><div className="text-xs text-zinc-500">{label}</div><div className="mt-1 text-xl font-semibold">{String(value ?? 0)}</div></div>; }
const STATUS: Record<string, string> = { received: "Получено", analyzing: "Анализ", review_required: "Требует проверки", approved: "Утверждено", publishing: "Публикуется", published: "Опубликовано", failed: "Ошибка", rejected: "Отклонено", superseded: "Заменено", pending: "Ожидает анализа", ready: "Готово", matched: "Найдено совпадение", conflict: "Конфликт", blocked: "Заблокировано", excluded: "Исключено" };
const ISSUES: Record<string, string> = { non_physical_asset: "Не является физическим движимым ОС", missing_inventory_number: "Нет инвентарного номера", missing_room: "Не выбран кабинет", unsupported_item_type: "Не выбран тип ТМЦ", negative_residual_value: "Отрицательная остаточная стоимость", zero_residual_value_unconfirmed: "Нулевая стоимость не подтверждена", quantity_requires_review: "Количество требует проверки", responsible_unassigned: "Ответственный не указан", accounting_status_requires_review: "Статус учета требует проверки", invalid_one_c_barcode: "Некорректный штрихкод 1С", identifier_conflict: "Конфликт идентификаторов" };
function issueLabel(value: string) { return ISSUES[value] ?? value; }
function reasonLabel(value: Reason) { return value === "guid" ? "GUID 1С" : value === "code" ? "Код 1С" : value === "barcode" ? "Штрихкод" : "Инвентарный номер"; }
function matchLabels(value: string) { const labels = value.replace(/^manual_/, "").split("+").filter((part): part is Reason => ["guid", "code", "inventory_number", "barcode"].includes(part)); return labels.length ? labels.map(reasonLabel).join(", ") : "идентификатор"; }
export function Status({ value }: { value: string }) { const danger = /conflict|failed|blocked/.test(value); return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${danger ? "bg-red-50 text-red-700" : value === "published" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{STATUS[value] ?? value}</span>; }
