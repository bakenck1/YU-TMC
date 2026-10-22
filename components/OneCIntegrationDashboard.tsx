"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Download, RefreshCw } from "lucide-react";
import OneCFixedAssetRegistryPanel from "@/components/OneCFixedAssetRegistryPanel";
import MaterialRegistryPanel from "@/components/MaterialRegistryPanel";
import { InventoryCurrentEnrichment } from "@/components/InventoryAuditEnrichment";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { OneCAnalytics } from "@/lib/one-c-analytics";
import type { MaterialRegistryMetadata } from "@/lib/contracts/inventory-source-audit";

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
const display = (value: number | null) => value === null ? "—" : number(value);
const tabs = [{ id: "overview", label: "Аналитика" }, { id: "assets", label: "ОС" }, { id: "materials", label: "Материальный предмет" }] as const;

const copy = {
  ru: { overview: "Аналитика", assets: "ОС", materials: "Материальный предмет", title: "Интеграция 1С", local: "Локально", download: "Скачать Excel · 5 листов", downloading: "Подготовка Excel…", downloadTitle: "5 листов: ОС, МП, найденные, временные, ненайденные", downloadError: "Не удалось скачать Excel. Повторите попытку.", refresh: "Обновить", refreshing: "Обновление…", navigation: "Разделы интеграции 1С", composition: "Состав 1С", activeTotal: "Всего активных в 1С", noTotal: "Нет данных для общего итога", totalHint: "ОС на учёте + материальные предметы с наличием", assetsSubtitle: "Основные средства", onBooks: "На учёте", noData: "Нет данных", positiveRows: "строк остатков с наличием", ourDatabase: "Наша база", activeCards: "активных карточек", cards: "Карточки", units: "Количество единиц", found: "Найдено в 1С", missing: "Не найдено в 1С", temporary: "Временные номера", reconciliation: "Сверка с 1С", scope: "Все карточки без архива · весь реестр 1С", foundShort: "найдено", checkNumber: "Нужно сверить номер", temporaryUnmatched: "Временные без совпадения", partial: "Сверка доступна по одному разделу.", noReconciliation: "Нет данных для сверки", attention: "Требует внимания", unmatched: "Без совпадения", excluded: "В показатель «Не найдено» не входят.", checkNumberHint: "Проверьте полный номер или штрихкод в найденных вариантах.", assetsNoMatch: "ОС без совпадения в нашей базе", materialsNoMatch: "МП без совпадения в нашей базе", positiveBalances: "Строки остатков с наличием" },
  kk: { overview: "Талдау", assets: "НҚ", materials: "Материалдық заттар", title: "1С интеграциясы", local: "Жергілікті", download: "Excel жүктеу · 5 парақ", downloading: "Excel дайындалуда…", downloadTitle: "5 парақ: НҚ, материалдар, табылғандар, уақытша нөмірлер, табылмағандар", downloadError: "Excel жүктелмеді. Қайта көріңіз.", refresh: "Жаңарту", refreshing: "Жаңартылуда…", navigation: "1С интеграциясының бөлімдері", composition: "1С құрамы", activeTotal: "1С-тегі белсенді позициялар", noTotal: "Жалпы санға дерек жоқ", totalHint: "Есептегі НҚ + қалдығы бар материалдық заттар", assetsSubtitle: "Негізгі құралдар", onBooks: "Есепте", noData: "Дерек жоқ", positiveRows: "қалдығы бар жол", ourDatabase: "Біздің база", activeCards: "белсенді карточка", cards: "Карточкалар", units: "Бірліктер саны", found: "1С-тен табылды", missing: "1С-тен табылмады", temporary: "Уақытша нөмірлер", reconciliation: "1С-пен салыстыру", scope: "Мұрағаттан тыс барлық карточка · 1С-тің толық тізімі", foundShort: "табылды", checkNumber: "Нөмірді тексеру керек", temporaryUnmatched: "Сәйкестігі жоқ уақытша нөмірлер", partial: "Тек бір бөлім бойынша салыстыруға болады.", noReconciliation: "Салыстыруға дерек жоқ", attention: "Назар аударыңыз", unmatched: "Сәйкестігі жоқ", excluded: "«Табылмады» санына кірмейді.", checkNumberHint: "Табылған нұсқалардағы толық нөмірді немесе штрихкодты тексеріңіз.", assetsNoMatch: "Біздің базада сәйкестігі жоқ НҚ", materialsNoMatch: "Біздің базада сәйкестігі жоқ материалдар", positiveBalances: "Қалдығы бар жолдар" },
  en: { overview: "Analytics", assets: "Fixed assets", materials: "Materials", title: "1C integration", local: "Local", download: "Download Excel · 5 sheets", downloading: "Preparing Excel…", downloadTitle: "5 sheets: fixed assets, materials, matched, temporary, unmatched", downloadError: "Could not download Excel. Please try again.", refresh: "Refresh", refreshing: "Refreshing…", navigation: "1C integration sections", composition: "1C inventory", activeTotal: "Active positions in 1C", noTotal: "No data for the total", totalHint: "Assets on the books + materials with a positive balance", assetsSubtitle: "Fixed assets", onBooks: "On the books", noData: "No data", positiveRows: "balance rows with stock", ourDatabase: "Our database", activeCards: "active cards", cards: "Cards", units: "Units", found: "Found in 1C", missing: "Not found in 1C", temporary: "Temporary numbers", reconciliation: "1C reconciliation", scope: "All non-archived cards · full 1C register", foundShort: "found", checkNumber: "Check the number", temporaryUnmatched: "Unmatched temporary numbers", partial: "Reconciliation is available for one section.", noReconciliation: "No reconciliation data", attention: "Needs attention", unmatched: "Unmatched", excluded: "Excluded from “Not found”.", checkNumberHint: "Check the full number or barcode in the possible matches.", assetsNoMatch: "Fixed assets absent from our database", materialsNoMatch: "Materials absent from our database", positiveBalances: "Balance rows with stock" },
} as const;

export default function OneCIntegrationDashboard({ analytics, materials, localEnvironment = false }: {
  analytics: OneCAnalytics; materials: MaterialRegistryMetadata;
  batches?: { data: Record<string, unknown>[]; page: number; pageSize: number; total: number };
  localEnvironment?: boolean;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("overview");
  const [refreshing, startRefresh] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const router = useRouter();
  const { language } = useAppSettings();
  const c = copy[language];
  const counts = analytics.reconciliation;
  const hasAssets = analytics.assets.receivedAt !== null;
  const hasMaterials = materials.batchId !== null;
  const hasSources = hasAssets || hasMaterials;
  const complete = hasAssets && hasMaterials;
  // One position is an OS GUID or a material code, never a balance row or quantity.
  const total = complete ? analytics.assets.total + materials.materialCount : null;
  const found = counts.fixedAssets + counts.materials + counts.both;
  const percent = counts.total ? found / counts.total * 100 : 0;
  const categories = [
    { label: c.assets, value: counts.fixedAssets, color: "bg-blue-600" },
    { label: c.materials, value: counts.materials + counts.both, color: "bg-emerald-500" },
    { label: c.checkNumber, value: counts.possible, color: "bg-amber-400" },
    { label: c.temporaryUnmatched, value: counts.temporaryUnmatched ?? 0, color: "bg-indigo-300" },
    { label: c.missing, value: counts.missing, color: "bg-slate-300" },
  ].filter(entry => entry.value > 0);
  async function downloadExcel() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/integrations/1c/analytics/export", { cache: "no-store" });
      if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("export_failed");
      const file = await response.blob();
      if (!file.size) throw new Error("export_empty");
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "1c-inventory.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setExportError(c.downloadError);
    } finally { setExporting(false); }
  }
  return <div className="space-y-6 rounded-3xl bg-gradient-to-b from-slate-50/80 via-sky-50/30 to-transparent p-1 sm:p-3">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold text-slate-900">{c.title}</h1>{localEnvironment ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">{c.local}</span> : null}</div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={exporting} onClick={() => void downloadExcel()} title={c.downloadTitle} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"><Download aria-hidden="true" className="h-4 w-4" />{exporting ? c.downloading : c.download}</button>
        <button type="button" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:opacity-50"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? c.refreshing : c.refresh}</button>
      </div>
    </header>
    {exportError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{exportError}</p> : null}
    <nav aria-label={c.navigation} className="flex w-fit flex-wrap gap-1 rounded-2xl border border-slate-200/70 bg-white/80 p-1.5 shadow-sm shadow-slate-200/40">{tabs.map(entry => <button type="button" key={entry.id} aria-pressed={tab === entry.id} onClick={() => setTab(entry.id)} className={`rounded-xl px-5 py-2.5 text-sm font-medium transition ${tab === entry.id ? "bg-slate-800 text-white shadow-sm" : "text-slate-500 hover:bg-sky-50 hover:text-slate-800"}`}>{c[entry.id]}</button>)}</nav>
    {tab === "overview" ? <div className="space-y-6" aria-busy={refreshing}>
      <section aria-label={c.composition} className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-gradient-to-br from-slate-800 via-[#164e63] to-teal-700 p-6 text-white shadow-lg shadow-teal-900/10">
          <h2 className="text-sm font-medium text-blue-100">{c.activeTotal}</h2><p className="mt-4 text-4xl font-semibold tabular-nums">{display(total)}</p>
          <p className="mt-2 text-sm text-blue-100">{total === null ? c.noTotal : c.totalHint}</p>
          <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-white/15" aria-hidden="true">{total !== null && total > 0 ? <><div className="bg-blue-400" style={{ width: `${analytics.assets.total / total * 100}%` }} /><div className="bg-emerald-400" style={{ width: `${materials.materialCount / total * 100}%` }} /></> : null}</div>
          {total !== null ? <p className="mt-3 text-xs text-blue-100">{number(analytics.assets.total)} {c.assets} + {number(materials.materialCount)} МП = {number(total)}</p> : null}
        </div>
        <SourceCard title={c.assets} subtitle={c.assetsSubtitle} value={hasAssets ? analytics.assets.total : null} kind="assets" onClick={() => setTab("assets")}>
          {hasAssets ? c.onBooks : c.noData}
        </SourceCard>
        <SourceCard title={c.materials} subtitle="МП" value={hasMaterials ? materials.materialCount : null} kind="materials" onClick={() => setTab("materials")}>
          {hasMaterials ? `${number(materials.positiveRows)} ${c.positiveRows}` : c.noData}
        </SourceCard>
      </section>
      <section aria-label={c.ourDatabase} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-900">{c.ourDatabase}</h2><span className="text-xs text-slate-500">{number(analytics.inventory.active)} {c.activeCards}</span></div>
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-5">
          <Metric label={c.cards} value={analytics.inventory.total} />
          <Metric label={c.units} value={analytics.inventory.quantity} />
          <Metric label={c.found} value={hasSources ? found : null} result="matched" />
          <Metric label={c.missing} value={hasSources ? counts.missing : null} result="missing" />
          <Metric label={c.temporary} value={counts.temporary} />
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{c.reconciliation}</h2><p className="mt-1 text-xs text-slate-500">{c.scope}</p></div><div className="text-right"><p className="text-2xl font-semibold text-emerald-700">{hasSources ? `${number(percent)}%` : "—"}</p><p className="text-xs text-slate-500">{c.foundShort}</p></div></div>
          {hasSources ? <>
            <div className="my-6 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">{categories.map(entry => <div key={entry.label} className={entry.color} style={{ width: `${counts.total ? entry.value / counts.total * 100 : 0}%` }} />)}</div>
            <ul className="divide-y divide-slate-100">{categories.map(entry => <li key={entry.label} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="flex items-center gap-2.5"><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${entry.color}`} />{entry.label}</span><span className="font-semibold tabular-nums text-slate-900">{number(entry.value)}</span></li>)}</ul>
            {!complete ? <p className="mt-3 text-xs text-slate-500">{c.partial}</p> : null}
          </> : <div role="status" className="my-6 rounded-xl bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">{c.noReconciliation}</div>}
        </section>
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold text-slate-900">{c.attention}</h2>
          <Attention title={c.temporary} value={counts.temporary} detail={`${c.unmatched}: ${number(counts.temporaryUnmatched ?? 0)}. ${c.excluded}`} />
          {counts.possible > 0 ? <Attention title={c.checkNumber} value={hasSources ? counts.possible : null} detail={c.checkNumberHint} /> : null}
          <Attention title={c.assetsNoMatch} value={hasAssets ? counts.assetsWithoutCandidate : null} detail={c.onBooks} />
          <Attention title={c.materialsNoMatch} value={hasMaterials ? counts.materialBalancesWithoutCandidate : null} detail={c.positiveBalances} />
        </section>
      </div>
    </div> : null}
    {tab !== "overview" ? <InventoryCurrentEnrichment blocked={refreshing} onApplied={() => startRefresh(() => router.refresh())} /> : null}
    {tab === "assets" ? <OneCFixedAssetRegistryPanel key={analytics.calculatedAt} /> : null}
    {tab === "materials" ? <MaterialRegistryPanel key={materials.sha256} source={materials} /> : null}
  </div>;
}

export function SourceCard({ title, subtitle, value, kind, onClick, children }: { title: string; subtitle: string; value: number | null; kind: "assets" | "materials"; onClick: () => void; children: React.ReactNode }) {
  const color = kind === "assets" ? "bg-blue-600" : "bg-emerald-500";
  return <button type="button" onClick={onClick} className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/70 p-6 text-left shadow-sm shadow-slate-200/30 transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"><div className="flex items-start justify-between gap-2"><div><span aria-hidden="true" className={`mb-3 block h-1 w-8 rounded-full ${color}`} /><h2 className="text-base font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><ArrowUpRight aria-hidden="true" className="h-4 w-4 text-slate-400" /></div><p className="mt-4 text-4xl font-semibold tabular-nums text-slate-900">{display(value)}</p><p className="mt-3 text-xs leading-5 text-slate-500">{children}</p></button>;
}
export function Metric({ label, value, result = "neutral" }: { label: string; value: number | null; result?: "neutral" | "matched" | "missing" }) {
  const color = result === "matched" ? "text-emerald-700" : result === "missing" ? "text-amber-700" : "text-slate-900";
  return <div><h3 className="text-xs text-slate-500">{label}</h3><p className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{display(value)}</p></div>;
}
export function Attention({ title, value, detail }: { title: string; value: number | null; detail?: string }) {
  return <div className="rounded-xl bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-medium text-slate-700">{title}</h3><span className="shrink-0 text-lg font-semibold tabular-nums text-slate-900">{display(value)}</span></div>{detail ? <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p> : null}</div>;
}
