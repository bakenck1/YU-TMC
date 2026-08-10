"use client";

import Link from "next/link";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type {
  TmcHistoryLocationChangeView,
  TmcHistoryRequestView,
} from "@/lib/tmc-history-view";

export default function TmcHistory({ requests, locationChanges = [], nextRequestHref = null, nextLocationHref = null }: {
  requests: TmcHistoryRequestView[];
  locationChanges?: TmcHistoryLocationChangeView[];
  nextRequestHref?: string | null;
  nextLocationHref?: string | null;
}) {
  const { t, language } = useAppSettings();
  const participants = unique(requests.flatMap((request) => [request.initiator, request.recipient]), "id");
  const items = unique(requests.flatMap((request) => request.items.map((entry) => entry.item)), "id");
  const locations = unique(items.map((item) => item.location), "roomId");
  const buildings = unique(locations.map((location) => ({ id: location.buildingId, name: location.buildingName })), "id");

  return (
    <section className="space-y-4">
      <form className="grid gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <select name="status" defaultValue="" className="min-h-11 rounded-xl border border-zinc-200 px-3"><option value="">{t("tmc.history.allStatuses")}</option>{["pending", "accepted", "rejected", "cancelled"].map((status) => <option key={status} value={status}>{t(`tmc.request.status.${status}` as never)}</option>)}</select>
        <input type="datetime-local" name="createdFrom" aria-label={t("tmc.history.from")} className="min-h-11 rounded-xl border border-zinc-200 px-3" />
        <input type="datetime-local" name="createdTo" aria-label={t("tmc.history.to")} className="min-h-11 rounded-xl border border-zinc-200 px-3" />
        <select name="initiatorId" defaultValue="" className="min-h-11 rounded-xl border border-zinc-200 px-3"><option value="">{t("tmc.history.allInitiators")}</option>{participants.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select>
        <select name="recipientId" defaultValue="" className="min-h-11 rounded-xl border border-zinc-200 px-3"><option value="">{t("tmc.history.allRecipients")}</option>{participants.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select>
        <select name="buildingId" defaultValue="" className="min-h-11 rounded-xl border border-zinc-200 px-3"><option value="">{t("tmc.history.allBuildings")}</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select>
        <select name="roomId" defaultValue="" className="min-h-11 rounded-xl border border-zinc-200 px-3"><option value="">{t("tmc.history.allRooms")}</option>{locations.map((location) => <option key={location.roomId} value={location.roomId}>{location.roomDesignation}</option>)}</select>
        <select name="itemId" defaultValue="" className="min-h-11 rounded-xl border border-zinc-200 px-3"><option value="">{t("tmc.history.allItems")}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.inventoryNumber}</option>)}</select>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 px-3"><input type="checkbox" name="overdue" value="true" /> {t("tmc.history.overdueOnly")}</label>
        <button className="min-h-11 rounded-xl bg-emerald-600 px-4 font-semibold text-white">{t("common.search")}</button>
        <Link href="/tmc/history" className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 px-4 font-semibold text-zinc-600">{t("tmc.history.reset")}</Link>
      </form>
      <div className="space-y-3">
        {requests.length === 0 ? <p className="rounded-2xl bg-white p-6 text-zinc-500">{t("tmc.history.empty")}</p> : requests.map((request) => (
          <Link key={request.id} href={`/tmc/transfer-requests/${request.id}`} className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm hover:border-emerald-300">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{request.initiator.fullName} → {request.recipient.fullName}</strong><span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold">{t(`tmc.request.status.${request.status}` as never)}</span></div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-500"><span>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.createdAt))}</span><span>{request.summary.total} {t("tmc.history.itemsCount")}</span>{request.overdue && <span className="font-semibold text-red-600">{t("tmc.request.overdue")}</span>}</div>
          </Link>
        ))}
        {nextRequestHref && <Link href={nextRequestHref} className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 font-semibold text-zinc-700">{t("tmc.history.loadOlderRequests")}</Link>}
      </div>
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-zinc-900">{t("tmc.history.locationChanges")}</h2>
        {locationChanges.map((change) => (
          <article key={change.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{change.itemName} · {change.inventoryNumber}</strong>
              <span className="text-sm text-zinc-500">{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(change.occurredAt))}</span>
            </div>
            <p className="mt-2 text-sm text-zinc-700">{change.beforeLocation} → {change.afterLocation}</p>
            <p className="mt-1 text-xs text-zinc-500">{t("tmc.history.changedBy")}: {change.actorName ?? "—"}</p>
            {change.comment && <p className="mt-2 text-sm text-zinc-600">{t("tmc.request.comment")}: {change.comment}</p>}
          </article>
        ))}
        {nextLocationHref && <Link href={nextLocationHref} className="flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 font-semibold text-zinc-700">{t("tmc.history.loadOlderLocations")}</Link>}
      </div>
    </section>
  );
}

function unique<Value extends Record<Key, string>, Key extends keyof Value>(values: Value[], key: Key) {
  return [...new Map(values.map((value) => [value[key], value])).values()];
}
