"use client";

import Link from "next/link";
import { useState } from "react";
import type { ButtonHTMLAttributes } from "react";

type Row = Record<string, unknown>;
type Page = { data: Row[]; page: number; pageSize: number; total: number };
type Reason = "guid" | "code" | "inventory_number";
type Candidate = { id: string; name: string; inventoryNumber: string; oneCCode: string | null; status: string; version: number; matchedBy: Reason[] };

export default function OneCReconciliationManager({ initialBatches }: { initialBatches: Page }) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [rows, setRows] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [proposedAction, setProposedAction] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [candidateRowId, setCandidateRowId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateBusy, setCandidateBusy] = useState(false);

  async function loadRows(batch: Row, page: number, overrides: { pageSize?: number; reviewState?: string; proposedAction?: string } = {}) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(overrides.pageSize ?? pageSize) });
    if (search.trim()) params.set("search", search.trim());
    const state = overrides.reviewState ?? reviewState;
    const action = overrides.proposedAction ?? proposedAction;
    if (state) params.set("reviewState", state);
    if (action) params.set("proposedAction", action);
    const value = await request(`/api/integrations/1c/batches/${batch.id}/rows?${params}`);
    setRows(value.rows as Page);
  }

  async function openBatch(batch: Row) {
    setSelected(batch); setBusy(true); setError(null); setCandidateRowId(null); setCandidates([]);
    try { await loadRows(batch, 1); } catch { setError("Не удалось загрузить строки сверки"); } finally { setBusy(false); }
  }

  async function analyze() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await request(`/api/integrations/1c/batches/${selected.id}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: selected.version }) });
      window.location.reload();
    } catch { setError("Анализ не выполнен. Обновите страницу и проверьте версию выгрузки."); setBusy(false); }
  }

  async function decide(row: Row, decision: Row) {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await request(`/api/integrations/1c/batches/${selected.id}/rows/${row.external_id}/decision`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: selected.version, decision }) });
      const updated = { ...selected, version: Number(selected.version) + 1 };
      setCandidateRowId(null); setCandidates([]);
      await openBatch(updated);
    } catch { setError("Решение не сохранено: кандидат мог измениться или уже связан с другим GUID."); setBusy(false); }
  }

  async function showCandidates(row: Row) {
    if (!selected) return;
    const externalId = String(row.external_id);
    if (candidateRowId === externalId) { setCandidateRowId(null); setCandidates([]); return; }
    setCandidateBusy(true); setError(null);
    try {
      const value = await request(`/api/integrations/1c/batches/${selected.id}/rows/${externalId}/candidates`);
      setCandidates(value.candidates as Candidate[]); setCandidateRowId(externalId);
    } catch { setError("Не удалось найти кандидатов по GUID, коду 1С и инвентарному номеру."); } finally { setCandidateBusy(false); }
  }

  async function reloadRows() {
    if (!selected) return;
    setBusy(true); try { await loadRows(selected, 1); } catch { setError("Поиск не выполнен"); } finally { setBusy(false); }
  }

  async function go(page: number) {
    if (!selected || !rows || page < 1 || page > Math.ceil(rows.total / rows.pageSize)) return;
    setBusy(true); try { await loadRows(selected, page); } catch { setError("Не удалось открыть страницу"); } finally { setBusy(false); }
  }

  async function transition(kind: "approve" | "publish") {
    if (!selected) return;
    const plan = (selected.summary as Row | undefined)?.plan as Row | undefined;
    if (typeof plan?.hash !== "string") { setError("Сначала выполните анализ."); return; }
    setBusy(true); setError(null);
    try {
      await request(`/api/integrations/1c/batches/${selected.id}/${kind}`, { method: "POST", headers: { "content-type": "application/json", ...(kind === "publish" ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: JSON.stringify({ version: selected.version, planHash: plan.hash }) });
      window.location.reload();
    } catch { setError(kind === "approve" ? "Выгрузка не готова к утверждению." : "Публикация отклонена; повторите dry-run."); setBusy(false); }
  }

  const massBlocked = ((selected?.summary as Row | undefined)?.massPublicationBlocked === true) || (selected?.request_id == null && selected?.source_filename == null);
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-zinc-900">Сверка основных средств 1С</h1><p className="mt-1 text-sm text-zinc-500">Импортные снимки не публикуются автоматически.</p></div>
      {selected ? <div className="flex flex-wrap gap-2"><a href={`/api/integrations/1c/batches/${selected.id}/export`} className="rounded-xl border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700">Скачать Excel ({String(selected.received_count)})</a><button disabled={busy} onClick={() => void analyze()} className="rounded-xl bg-[#002060] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Запустить dry-run</button>{selected.state === "review_required" && !massBlocked ? <button disabled={busy} onClick={() => void transition("approve")} className="rounded-xl border px-4 py-2 text-sm">Утвердить</button> : null}{selected.state === "approved" && !massBlocked ? <button disabled={busy} onClick={() => void transition("publish")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm text-white">Опубликовать</button> : null}</div> : null}
    </header>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {selected && massBlocked ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Это исторический снимок без исходного XML. Его можно просматривать, искать и выгружать в Excel, но утверждение и публикация заблокированы. Для публикации используйте новый полный XML-пакет от 1С.</p> : null}
    <BatchTable batches={initialBatches.data} onOpen={openBatch}/>
    {selected ? <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Card label="Всего" value={selected.received_count}/><Card label="Создано во входящем реестре" value={selected.created_count}/><Card label="Обновлено" value={selected.updated_count}/><Card label="Без изменений" value={selected.unchanged_count}/></div>
      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/5 p-4"><div><h2 className="font-semibold">Строки сверки</h2><p className="text-xs text-zinc-500">{rows ? `Показано ${rows.total ? (rows.page - 1) * rows.pageSize + 1 : 0}–${Math.min(rows.page * rows.pageSize, rows.total)} из ${rows.total}` : "Загрузка списка"}</p></div>
          <form onSubmit={(event) => { event.preventDefault(); void reloadRows(); }} className="flex flex-wrap gap-2"><input aria-label="Поиск по строкам" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-64 rounded-lg border border-zinc-200 px-3 py-2" placeholder="GUID, код, номер, название, ответственный"/><Filter value={reviewState} label="Статус проверки" onChange={(value) => { setReviewState(value); setBusy(true); void loadRows(selected, 1, { reviewState: value }).catch(() => setError("Фильтр не применён")).finally(() => setBusy(false)); }} options={[["", "Все статусы"], ["matched", "Найдено совпадение"], ["blocked", "Заблокировано"], ["conflict", "Конфликт"], ["excluded", "Исключено"], ["approved", "Подтверждено"], ["published", "Опубликовано"]]}/><Filter value={proposedAction} label="Действие" onChange={(value) => { setProposedAction(value); setBusy(true); void loadRows(selected, 1, { proposedAction: value }).catch(() => setError("Фильтр не применён")).finally(() => setBusy(false)); }} options={[["", "Все действия"], ["link", "Связать"], ["create", "Создать"], ["manual_review", "Ручная проверка"], ["exclude", "Исключить"]]}/><select aria-label="Строк на странице" value={pageSize} onChange={(event) => { const value = Number(event.target.value); setPageSize(value); setBusy(true); void loadRows(selected, 1, { pageSize: value }).finally(() => setBusy(false)); }} className="rounded-lg border border-zinc-200 px-3 py-2"><option value="50">50 строк</option><option value="100">100 строк</option></select><button className="rounded-lg border px-3 py-2">Найти</button></form>
        </div>
        {busy ? <p className="p-6 text-sm text-zinc-500">Загрузка…</p> : <><div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-zinc-50"><tr><th className="p-3">Проверка</th><th className="p-3">GUID / код</th><th className="p-3">Инв. номер / barcode</th><th className="p-3">Название</th><th className="p-3">Подразделение / ответственный</th><th className="p-3">Остаточная стоимость</th><th className="p-3">Найденный предмет</th><th className="p-3">Решение</th></tr></thead><tbody>{rows?.data.map((row) => <AssetRow key={String(row.external_id)} row={row} open={candidateRowId === String(row.external_id)} candidates={candidates} candidateBusy={candidateBusy} show={showCandidates} decide={decide}/>)}</tbody></table></div>{rows && rows.total > rows.pageSize ? <div className="flex items-center justify-between border-t p-4 text-sm"><span>Страница {rows.page} из {Math.ceil(rows.total / rows.pageSize)}</span><div className="flex gap-2"><PageButton disabled={rows.page === 1} onClick={() => void go(1)}>Первая</PageButton><PageButton disabled={rows.page === 1} onClick={() => void go(rows.page - 1)}>Назад</PageButton><PageButton disabled={rows.page >= Math.ceil(rows.total / rows.pageSize)} onClick={() => void go(rows.page + 1)}>Далее</PageButton><PageButton disabled={rows.page >= Math.ceil(rows.total / rows.pageSize)} onClick={() => void go(Math.ceil(rows.total / rows.pageSize))}>Последняя</PageButton></div></div> : null}</>}
      </div>
    </section> : null}
  </div>;
}

export function BatchTable({ batches, onOpen }: { batches: Row[]; onOpen(batch: Row): Promise<void> }) { return <section aria-label="Выгрузки 1С" className="overflow-hidden rounded-2xl border border-black/5 bg-white"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-zinc-50 text-zinc-500"><tr><th className="p-3">Получена</th><th className="p-3">Файл / SHA-256</th><th className="p-3">Строки</th><th className="p-3">Статус</th><th className="p-3">Действие</th></tr></thead><tbody>{batches.map((batch) => <tr key={String(batch.id)} className="border-t"><td className="p-3">{formatDate(batch.received_at)}</td><td className="p-3"><div>{String(batch.source_filename ?? "Без имени")}</div><code className="text-xs text-zinc-500">{String(batch.source_sha256).slice(0, 16)}…</code></td><td className="p-3">{String(batch.received_count)}</td><td className="p-3"><Status value={String(batch.state)}/></td><td className="p-3"><button onClick={() => void onOpen(batch)} className="font-medium text-blue-700 hover:underline">Открыть сверку</button></td></tr>)}</tbody></table></div>{!batches.length ? <p className="p-6 text-center text-sm text-zinc-500">Выгрузок пока нет</p> : null}</section>; }

export function AssetRow({ row, open, candidates, candidateBusy, show, decide }: { row: Row; open: boolean; candidates: Candidate[]; candidateBusy: boolean; show(row: Row): Promise<void>; decide(row: Row, decision: Row): Promise<void> }) {
  const payload = row.payload as Row;
  return <tr className="border-t align-top"><td className="p-3"><Status value={String(row.review_state)}/></td><td className="p-3"><code>{String(row.external_id)}</code><div>{String(payload.code ?? "—")}</div></td><td className="p-3"><div>{String(payload.inventoryNumber ?? "Не передан")}</div><div className="text-zinc-500">{payload.barcode ? String(payload.barcode) : "Штрихкод 1С не передан"}</div></td><td className="p-3">{String(payload.name)}</td><td className="p-3"><div>{String(payload.location ?? "—")}</div><div className="text-zinc-500">{String(payload.responsibleName ?? "Ответственный не указан")}</div></td><td className="p-3">{payload.residualCost === null ? "Не передана" : String(payload.residualCost)}</td><td className="p-3">{row.matched_item_id ? <Link className="text-blue-700 hover:underline" href={`/items/${row.matched_item_id}`}>{String(row.matched_item_name ?? row.matched_item_id)}</Link> : "—"}<div>{Array.isArray(row.issues) && row.issues.length ? row.issues.map((issue) => issueLabel(String((issue as Row).code))).join(", ") : "Нет проблем"}</div></td><td className="space-y-2 p-3"><button className="block font-medium text-blue-700 hover:underline" onClick={() => void show(row)}>{open ? "Закрыть кандидатов" : "Выбрать другой предмет"}</button>{open ? <CandidateList row={row} candidates={candidates} busy={candidateBusy} decide={decide}/> : null}<button className="block text-zinc-600 hover:underline" onClick={() => void decide(row, { exclude: true })}>Исключить строку</button></td></tr>;
}

export function CandidateList({ row, candidates, busy, decide }: { row: Row; candidates: Candidate[]; busy: boolean; decide(row: Row, decision: Row): Promise<void> }) { return <div className="min-w-72 space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-2">{busy ? <p>Поиск…</p> : candidates.length ? candidates.map((candidate) => <div key={candidate.id} className="rounded-lg bg-white p-2 shadow-sm"><Link className="font-medium text-blue-800 hover:underline" href={`/items/${candidate.id}`}>{candidate.name}</Link><div className="mt-1">Инв. №: {candidate.inventoryNumber || "—"}</div><div>Код 1С: {candidate.oneCCode || "—"}</div><div>Статус: {STATUS[candidate.status] ?? candidate.status}</div><div className="mt-1 flex flex-wrap gap-1">{candidate.matchedBy.map((reason) => <span key={reason} className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">{reasonLabel(reason)}</span>)}</div><button className="mt-2 rounded-lg bg-[#002060] px-3 py-1.5 font-medium text-white" onClick={() => void decide(row, { confirmLink: true, itemId: candidate.id, expectedItemVersion: candidate.version })}>Связать с этим предметом</button></div>) : <p className="text-zinc-600">Точных совпадений по трём полям нет.</p>}</div>; }

export function Filter({ value, label, onChange, options }: { value: string; label: string; onChange(value: string): void; options: string[][] }) { return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-zinc-200 px-3 py-2">{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>; }
export function PageButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button type="button" {...props} className="rounded-lg border px-3 py-2 disabled:opacity-40">{children}</button>; }
async function request(url: string, init?: RequestInit) { const response = await fetch(url, { ...init, credentials: "same-origin" }); if (!response.ok) throw new Error("request_failed"); return response.json() as Promise<Row>; }
function formatDate(value: unknown) { const date = new Date(String(value)); return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date); }
export function Card({ label, value }: { label: string; value: unknown }) { return <div className="rounded-2xl border border-black/5 bg-white p-4"><div className="text-xs text-zinc-500">{label}</div><div className="mt-1 text-xl font-semibold">{String(value ?? 0)}</div></div>; }
const STATUS: Record<string, string> = { received: "Получено", analyzing: "Анализ", review_required: "Требует проверки", approved: "Утверждено", publishing: "Публикуется", published: "Опубликовано", failed: "Ошибка", rejected: "Отклонено", superseded: "Заменено", pending: "Ожидает анализа", ready: "Готово", matched: "Найдено совпадение", conflict: "Конфликт", blocked: "Заблокировано", excluded: "Исключено" };
const ISSUES: Record<string, string> = { non_physical_asset: "Не является физическим движимым ОС", missing_inventory_number: "Нет инвентарного номера", missing_room: "Не выбран кабинет", unsupported_item_type: "Не выбран тип ТМЦ", negative_residual_value: "Отрицательная остаточная стоимость", zero_residual_value_unconfirmed: "Нулевая стоимость не подтверждена", quantity_requires_review: "Количество требует проверки", responsible_unassigned: "Ответственный не указан", accounting_status_requires_review: "Статус учета требует проверки", invalid_one_c_barcode: "Некорректный штрихкод 1С", identifier_conflict: "Конфликт идентификаторов" };
function issueLabel(value: string) { return ISSUES[value] ?? value; }
function reasonLabel(value: Reason) { return value === "guid" ? "GUID 1С" : value === "code" ? "Код 1С" : "Инвентарный номер"; }
export function Status({ value }: { value: string }) { const danger = /conflict|failed|blocked/.test(value); return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${danger ? "bg-red-50 text-red-700" : value === "published" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{STATUS[value] ?? value}</span>; }
