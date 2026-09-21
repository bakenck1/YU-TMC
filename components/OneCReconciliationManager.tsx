"use client";

import Link from "next/link";
import { useState } from "react";

type PageResult = { data: Record<string, unknown>[]; page: number; pageSize: number; total: number };

export default function OneCReconciliationManager({ initialBatches }: { initialBatches: PageResult }) {
  const [batches] = useState(initialBatches);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [rows, setRows] = useState<PageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [proposedAction, setProposedAction] = useState("");
  const [pageSize, setPageSize] = useState(50);

  async function openBatch(batch: Record<string, unknown>) {
    setSelected(batch); setBusy(true); setError(null);
    try { await loadRows(batch, 1); }
    catch { setError("Не удалось загрузить строки сверки"); }
    finally { setBusy(false); }
  }

  async function loadRows(batch: Record<string, unknown>, page: number, overrides: { pageSize?: number; reviewState?: string; proposedAction?: string } = {}) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(overrides.pageSize ?? pageSize) });
    const normalizedSearch = search.trim();
    const state = overrides.reviewState ?? reviewState;
    const action = overrides.proposedAction ?? proposedAction;
    if (normalizedSearch) params.set("search", normalizedSearch);
    if (state) params.set("reviewState", state);
    if (action) params.set("proposedAction", action);
    setRows(await request(`/api/integrations/1c/batches/${batch.id}/rows?${params}`).then((value) => value.rows as PageResult));
  }

  async function analyze() {
    if (!selected) return; setBusy(true); setError(null);
    try { await request(`/api/integrations/1c/batches/${selected.id}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: selected.version }) }); window.location.reload(); }
    catch { setError("Анализ не выполнен. Обновите страницу и проверьте версию выгрузки."); setBusy(false); }
  }

  async function decide(row: Record<string, unknown>, decision: Record<string, unknown>) {
    if (!selected) return; setBusy(true); setError(null);
    try {
      await request(`/api/integrations/1c/batches/${selected.id}/rows/${row.external_id}/decision`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: selected.version, decision }) });
      setSelected({ ...selected, version: Number(selected.version) + 1 });
      await openBatch({ ...selected, version: Number(selected.version) + 1 });
    } catch { setError("Решение не сохранено: данные могли измениться."); setBusy(false); }
  }

  async function reloadRows() {
    if (!selected) return; setBusy(true);
    try { await loadRows(selected, 1); }
    catch { setError("Поиск не выполнен"); }
    finally { setBusy(false); }
  }

  async function goToPage(page: number) {
    if (!selected || !rows || page < 1 || page > Math.ceil(rows.total / rows.pageSize)) return;
    setBusy(true); setError(null);
    try { await loadRows(selected, page); }
    catch { setError("Не удалось открыть страницу"); }
    finally { setBusy(false); }
  }

  async function transition(kind: "approve" | "publish") {
    if (!selected) return;
    const summary=selected.summary as Record<string,unknown>|undefined;
    const plan=summary?.plan as Record<string,unknown>|undefined;
    const planHash=typeof plan?.hash==="string"?plan.hash:null;
    if(!planHash){setError("Сначала выполните анализ.");return;}
    setBusy(true);setError(null);
    try{await request(`/api/integrations/1c/batches/${selected.id}/${kind}`,{method:"POST",headers:{"content-type":"application/json",...(kind==="publish"?{"idempotency-key":crypto.randomUUID()}: {})},body:JSON.stringify({version:selected.version,planHash})});window.location.reload();}
    catch{setError(kind==="approve"?"Выгрузка не готова к утверждению.":"Публикация отклонена; повторите dry-run.");setBusy(false);}
  }

  const selectedSummary = selected?.summary as Record<string, unknown> | undefined;
  const massPublicationBlocked = selectedSummary?.massPublicationBlocked === true
    || (selected?.request_id == null && selected?.source_filename == null);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-zinc-900">Сверка основных средств 1С</h1><p className="mt-1 text-sm text-zinc-500">Импортные снимки не публикуются автоматически.</p></div>{selected ? <div className="flex flex-wrap gap-2"><a href={`/api/integrations/1c/batches/${selected.id}/export`} className="rounded-xl border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700">Скачать Excel ({String(selected.received_count)})</a><button type="button" disabled={busy} onClick={() => void analyze()} className="rounded-xl bg-[#002060] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Запустить dry-run</button>{selected.state==="review_required"&&!massPublicationBlocked?<button type="button" disabled={busy} onClick={()=>void transition("approve")} className="rounded-xl border px-4 py-2 text-sm">Утвердить</button>:null}{selected.state==="approved"&&!massPublicationBlocked?<button type="button" disabled={busy} onClick={()=>void transition("publish")} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm text-white">Опубликовать</button>:null}</div> : null}</div>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {selected && massPublicationBlocked ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Это исторический снимок без исходного XML. Его можно просматривать, искать и выгружать в Excel, но утверждение и публикация заблокированы. Для публикации используйте новый полный XML-пакет от 1С.</p> : null}
    <section aria-label="Выгрузки 1С" className="overflow-hidden rounded-2xl border border-black/5 bg-white">
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-zinc-50 text-zinc-500"><tr><th className="p-3">Получена</th><th className="p-3">Файл / SHA-256</th><th className="p-3">Строки</th><th className="p-3">Статус</th><th className="p-3">Действие</th></tr></thead><tbody>{batches.data.map((batch) => <tr key={String(batch.id)} className="border-t border-black/5"><td className="p-3">{formatDate(batch.received_at)}</td><td className="p-3"><div>{String(batch.source_filename ?? "Без имени")}</div><code className="text-xs text-zinc-500">{String(batch.source_sha256).slice(0,16)}…</code></td><td className="p-3">{String(batch.received_count)}</td><td className="p-3"><Status value={String(batch.state)} /></td><td className="p-3"><button type="button" onClick={() => void openBatch(batch)} className="font-medium text-blue-700 hover:underline">Открыть сверку</button></td></tr>)}</tbody></table></div>
      {!batches.data.length ? <p className="p-6 text-center text-sm text-zinc-500">Выгрузок пока нет</p> : null}
    </section>
    {selected ? <section className="space-y-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Card label="Всего" value={selected.received_count}/><Card label="Создано во входящем реестре" value={selected.created_count}/><Card label="Обновлено" value={selected.updated_count}/><Card label="Без изменений" value={selected.unchanged_count}/></div>
      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/5 p-4"><div><h2 className="font-semibold">Строки сверки</h2><p className="text-xs text-zinc-500">{rows ? `Показано ${rows.total ? (rows.page-1)*rows.pageSize+1 : 0}–${Math.min(rows.page*rows.pageSize,rows.total)} из ${rows.total}` : "Загрузка списка"}</p></div><form onSubmit={(event)=>{event.preventDefault();void reloadRows();}} className="flex flex-wrap gap-2"><input aria-label="Поиск по строкам" value={search} onChange={(event)=>setSearch(event.target.value)} className="min-w-64 rounded-lg border border-zinc-200 px-3 py-2" placeholder="GUID, код, номер, название, ответственный"/><select aria-label="Статус проверки" value={reviewState} onChange={(event)=>{const value=event.target.value;setReviewState(value);if(selected){setBusy(true);void loadRows(selected,1,{reviewState:value}).catch(()=>setError("Фильтр не применён")).finally(()=>setBusy(false));}}} className="rounded-lg border border-zinc-200 px-3 py-2"><option value="">Все статусы</option><option value="matched">Найдено совпадение</option><option value="blocked">Заблокировано</option><option value="conflict">Конфликт</option><option value="excluded">Исключено</option><option value="approved">Подтверждено</option><option value="published">Опубликовано</option></select><select aria-label="Действие" value={proposedAction} onChange={(event)=>{const value=event.target.value;setProposedAction(value);if(selected){setBusy(true);void loadRows(selected,1,{proposedAction:value}).catch(()=>setError("Фильтр не применён")).finally(()=>setBusy(false));}}} className="rounded-lg border border-zinc-200 px-3 py-2"><option value="">Все действия</option><option value="link">Связать</option><option value="create">Создать</option><option value="manual_review">Ручная проверка</option><option value="exclude">Исключить</option><option value="no_change">Без изменений</option></select><select aria-label="Строк на странице" value={pageSize} onChange={(event)=>{const value=Number(event.target.value);setPageSize(value);if(selected){setBusy(true);void loadRows(selected,1,{pageSize:value}).catch(()=>setError("Размер страницы не изменён")).finally(()=>setBusy(false));}}} className="rounded-lg border border-zinc-200 px-3 py-2"><option value="50">50 строк</option><option value="100">100 строк</option></select><button className="rounded-lg border px-3 py-2">Найти</button></form></div>{busy ? <p className="p-6 text-sm text-zinc-500">Загрузка…</p> : <><div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-zinc-50"><tr><th className="p-3">Проверка</th><th className="p-3">GUID / код</th><th className="p-3">Инв. номер / barcode</th><th className="p-3">Название</th><th className="p-3">Подразделение / ответственный</th><th className="p-3">Остаточная стоимость</th><th className="p-3">Найденный предмет</th><th className="p-3">Решение</th></tr></thead><tbody>{rows?.data.map((row) => {const payload=row.payload as Record<string,unknown>;return <tr key={String(row.external_id)} className="border-t border-black/5 align-top"><td className="p-3"><Status value={String(row.review_state)}/></td><td className="p-3"><code>{String(row.external_id)}</code><div>{String(payload.code??"—")}</div></td><td className="p-3"><div>{String(payload.inventoryNumber??"Не передан")}</div><div className="text-zinc-500">{payload.barcode ? String(payload.barcode) : "Штрихкод 1С не передан"}</div></td><td className="p-3">{String(payload.name)}</td><td className="p-3"><div>{String(payload.location??"—")}</div><div className="text-zinc-500">{String(payload.responsibleName??"Ответственный не указан")}</div></td><td className="p-3">{payload.residualCost===null?"Не передана":String(payload.residualCost)}</td><td className="p-3">{row.matched_item_id?<Link className="text-blue-700 hover:underline" href={`/items/${row.matched_item_id}`}>{String(row.matched_item_name??row.matched_item_id)}</Link>:"—"}<div>{Array.isArray(row.issues)&&row.issues.length?row.issues.map((x)=>issueLabel(String((x as Record<string,unknown>).code))).join(", "):"Нет проблем"}</div></td><td className="space-y-2 p-3">{row.matched_item_id&&row.review_state!=="conflict"?<button className="block text-blue-700 hover:underline" onClick={()=>void decide(row,{confirmLink:true,itemId:row.matched_item_id})}>Связать без изменения</button>:null}<button className="block text-zinc-600 hover:underline" onClick={()=>void decide(row,{exclude:true})}>Исключить строку</button></td></tr>})}</tbody></table></div>{rows&&rows.total>rows.pageSize?<div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 p-4 text-sm"><span>Страница {rows.page} из {Math.ceil(rows.total/rows.pageSize)}</span><div className="flex gap-2"><button type="button" disabled={rows.page===1} onClick={()=>void goToPage(1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Первая</button><button type="button" disabled={rows.page===1} onClick={()=>void goToPage(rows.page-1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Назад</button><button type="button" disabled={rows.page>=Math.ceil(rows.total/rows.pageSize)} onClick={()=>void goToPage(rows.page+1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Далее</button><button type="button" disabled={rows.page>=Math.ceil(rows.total/rows.pageSize)} onClick={()=>void goToPage(Math.ceil(rows.total/rows.pageSize))} className="rounded-lg border px-3 py-2 disabled:opacity-40">Последняя</button></div></div>:null}</>}</div>
    </section> : null}
  </div>;
}

async function request(url:string,init?:RequestInit){const response=await fetch(url,{...init,credentials:"same-origin"});if(!response.ok)throw new Error("request_failed");return response.json() as Promise<Record<string,unknown>>;}
function formatDate(value:unknown){const date=new Date(String(value));return Number.isNaN(date.valueOf())?"—":new Intl.DateTimeFormat("ru-RU",{dateStyle:"medium",timeStyle:"short"}).format(date);}
export function Card({label,value}:{label:string;value:unknown}){return <div className="rounded-2xl border border-black/5 bg-white p-4"><div className="text-xs text-zinc-500">{label}</div><div className="mt-1 text-xl font-semibold">{String(value??0)}</div></div>;}
const STATUS_LABELS:Record<string,string>={received:"Получено",analyzing:"Анализ",review_required:"Требует проверки",approved:"Утверждено",publishing:"Публикуется",published:"Опубликовано",failed:"Ошибка",rejected:"Отклонено",superseded:"Заменено",pending:"Ожидает анализа",ready:"Готово",matched:"Найдено совпадение",conflict:"Конфликт",blocked:"Заблокировано",excluded:"Исключено"};
const ISSUE_LABELS:Record<string,string>={non_physical_asset:"Не является физическим движимым ОС",missing_inventory_number:"Нет инвентарного номера",missing_room:"Не выбран кабинет",unsupported_item_type:"Не выбран тип ТМЦ",negative_residual_value:"Отрицательная остаточная стоимость",zero_residual_value_unconfirmed:"Нулевая стоимость не подтверждена",quantity_requires_review:"Количество требует проверки",responsible_unassigned:"Ответственный не указан",accounting_status_requires_review:"Статус учета требует проверки",invalid_one_c_barcode:"Некорректный штрихкод 1С",identifier_conflict:"Конфликт идентификаторов"};
function issueLabel(value:string){return ISSUE_LABELS[value]??value;}
export function Status({value}:{value:string}){const danger=/conflict|failed|blocked/.test(value);return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${danger?"bg-red-50 text-red-700":value==="published"?"bg-emerald-50 text-emerald-700":"bg-blue-50 text-blue-700"}`}>{STATUS_LABELS[value]??value}</span>;}
