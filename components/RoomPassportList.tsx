"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, MessageSquareText, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { PASSPORT_STATUSES, type PassportStatus, type RoomPassportDto } from "@/lib/contracts/room-passports";
import type { TranslationKey } from "@/lib/i18n";
import { EMPTY_PASSPORT_FILTERS, PASSPORT_LIST_PATH, normalizePassportFilters, parsePassportFilters, passportDetailsHref, passportListHref, type RoomPassportFilters } from "@/lib/room-passport-list-state";

const STATUS_STYLES: Record<PassportStatus, string> = {
  not_started: "border-zinc-200 bg-zinc-100 text-zinc-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-800",
  in_review: "border-orange-200 bg-orange-100 text-orange-900",
  needs_correction: "border-red-200 bg-red-50 text-red-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

function passportPriority(status: PassportStatus, prioritizeReview: boolean) {
  if (status === "approved") return 2;
  return prioritizeReview && status === "in_review" ? 0 : 1;
}

export default function RoomPassportList({ passports, prioritizeReview = false, initialFilters = EMPTY_PASSPORT_FILTERS }: {
  passports: RoomPassportDto[];
  prioritizeReview?: boolean;
  initialFilters?: RoomPassportFilters;
}) {
  const { t, dataLabel } = useAppSettings();
  const [filters, setFilters] = useState(() => normalizePassportFilters(
    typeof window !== "undefined" && window.location.pathname === PASSPORT_LIST_PATH
      ? parsePassportFilters(new URLSearchParams(window.location.search)) : initialFilters,
    passports,
  ));
  const currentFilters = normalizePassportFilters(filters, passports);
  const { building, floor, room, status } = currentFilters;
  if (filters.building !== building || filters.floor !== floor || filters.room !== room) setFilters(currentFilters);
  const listHref = passportListHref(currentFilters);
  function updateFilters(change: Partial<RoomPassportFilters>) { setFilters({ ...currentFilters, ...change }); }
  useEffect(() => {
    if (window.location.pathname === PASSPORT_LIST_PATH && `${window.location.pathname}${window.location.search}` !== listHref) {
      window.history.replaceState(null, "", listHref);
    }
  }, [listHref]);
  useEffect(() => {
    function restoreFilters() {
      if (window.location.pathname === PASSPORT_LIST_PATH) setFilters(parsePassportFilters(new URLSearchParams(window.location.search)));
    }
    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, []);
  const buildings = [...new Map(passports.map(row => [row.buildingId, row.buildingName])).entries()];
  const byBuilding = passports.filter(row => !building || row.buildingId === building);
  const floors = [...new Set(byBuilding.map(row => row.floorNumber))].sort((a, b) => a - b);
  const rooms = byBuilding.filter(row => !floor || String(row.floorNumber) === floor);
  const matchingLocation = useMemo(() => passports.filter(row =>
    (!building || row.buildingId === building) &&
    (!floor || String(row.floorNumber) === floor) &&
    (!room || row.roomId === room)
  ), [passports, building, floor, room]);
  const reviewCount = matchingLocation.filter(row => row.status === "in_review").length;
  const filtered = useMemo(() => {
    const result = matchingLocation.filter(row => !status || row.status === status);
    return result.sort((left, right) =>
      passportPriority(left.status, prioritizeReview) - passportPriority(right.status, prioritizeReview)
    );
  }, [matchingLocation, status, prioritizeReview]);
  function select(label: TranslationKey, value: string, change: (value: string) => void, options: [string, string][]) {
    return <label className="space-y-1 text-sm font-medium text-zinc-700"><span>{t(label)}</span><select value={value} onChange={event => change(event.target.value)} className="min-h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:text-sm"><option value="">{t("passport.all")}</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
  }
  return <main className="space-y-5 pb-24 md:pb-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-[#002060]">{t("passport.title")}</h1>
        {prioritizeReview ? <p className="text-sm text-zinc-600">{t("passport.reviewOrder")}</p> : null}
      </div>
      {prioritizeReview ? <button
        type="button"
        aria-pressed={status === "in_review"}
        onClick={() => updateFilters({ status: status === "in_review" ? "" : "in_review" })}
        className={`inline-flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm font-semibold text-orange-900 transition-colors hover:bg-orange-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 ${status === "in_review" ? "border-orange-500 bg-orange-200" : "border-orange-200 bg-orange-100"}`}
      >
        {t("passport.status.in_review")}{" "}
        <span className="rounded-lg bg-white px-2.5 py-1 tabular-nums">{reviewCount}</span>
      </button> : null}
    </header>
    <section aria-label={t("passport.filters")} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-800"><SlidersHorizontal size={16} aria-hidden="true" />{t("passport.filters")}</h2>
        <button type="button" disabled={!building && !floor && !room && !status} onClick={() => setFilters({ ...EMPTY_PASSPORT_FILTERS })} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-blue-800 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-default disabled:text-zinc-400 disabled:hover:bg-transparent"><RotateCcw size={14} aria-hidden="true" />{t("passport.reset")}</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {select("passport.building", building, value => updateFilters({ building: value, floor: "", room: "" }), buildings.map(([id, name]) => [id, dataLabel(name)]))}
        {select("passport.floor", floor, value => updateFilters({ floor: value, room: "" }), floors.map(value => [String(value), String(value)]))}
        {select("passport.room", room, value => updateFilters({ room: value }), rooms.map(row => [row.roomId, `${row.designation} · ${dataLabel(row.buildingName)} · ${row.floorLabel ?? row.floorNumber}`]))}
        {select("passport.status", status, value => updateFilters({ status: value as RoomPassportFilters["status"] }), PASSPORT_STATUSES.map(value => [value, t(`passport.status.${value}`)]))}
      </div>
    </section>
    <p className="text-sm text-zinc-500" aria-live="polite">{t("passport.foundRooms")}: <span className="font-semibold tabular-nums text-zinc-700">{filtered.length}</span></p>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {filtered.map(row => {
        const remark = row.status === "in_progress" && row.rejectionReason ? t(`passport.reason.${row.rejectionReason}`) : null;
        return <article key={row.roomId} className="min-w-0">
        <Link
          href={passportDetailsHref(row.roomId, listHref)}
          aria-label={`${t("passport.open")}: ${row.designation} · ${dataLabel(row.buildingName)} · ${t("passport.floor")}: ${row.floorLabel ?? row.floorNumber} · ${t(`passport.status.${row.status}`)}${remark ? ` · ${t("passport.hasRemarks")}: ${remark}` : ""}`}
          className={`group flex h-full flex-col gap-4 rounded-2xl border bg-white p-5 transition-colors hover:bg-zinc-50 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 ${row.status === "in_review" ? "border-orange-200 hover:border-orange-400" : "border-zinc-200 hover:border-zinc-300"}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-full">
              <p className="text-xs font-medium text-zinc-500">{t("passport.room")}</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#002060] [overflow-wrap:anywhere]">{row.designation}</h2>
            </div>
            <div className="flex max-w-full flex-wrap items-center gap-2">
              {remark ? <p className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900"><MessageSquareText size={14} className="shrink-0" aria-hidden="true" />{t("passport.hasRemarks")}</p> : null}
              <p className={`inline-flex rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${STATUS_STYLES[row.status]}`}>{t(`passport.status.${row.status}`)}</p>
            </div>
          </div>
          {remark ? <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 [overflow-wrap:anywhere]"><p className="line-clamp-2">{remark}{row.rejectionComment ? `: ${row.rejectionComment}` : ""}</p></div> : null}
          <div className="flex items-start gap-2 text-sm text-zinc-600">
            <Building2 size={16} className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="[overflow-wrap:anywhere]">{dataLabel(row.buildingName)}</p>
              <p className="text-zinc-500">{t("passport.floor")}: {row.floorLabel ?? row.floorNumber}</p>
            </div>
          </div>
          {row.status === "needs_correction" ? <p className="text-sm text-red-800">{t("passport.correctionHint")}</p> : null}
          <div className="mt-auto flex min-h-11 items-center justify-between gap-3 border-t border-zinc-100 pt-3 text-sm font-semibold text-blue-900">
            <span className="group-hover:underline">{t("passport.open")}</span><ArrowRight size={18} className="shrink-0 text-blue-800" aria-hidden="true" />
          </div>
        </Link>
      </article>;
      })}
    </div>
    {!filtered.length ? <p role="status" className="rounded-2xl bg-white p-6 text-center text-zinc-600">{t("passport.empty")}</p> : null}
  </main>;
}
