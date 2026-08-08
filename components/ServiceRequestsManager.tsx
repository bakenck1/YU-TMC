"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import type { ServiceRequestStatus } from "@/lib/contracts/inventory-domain";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function ServiceRequestsManager({
  initialRequests,
  canManage,
}: {
  initialRequests: ServiceRequestDto[];
  canManage: boolean;
}) {
  const { language, t } = useAppSettings();
  const [requests, setRequests] = useState(initialRequests);
  const [status, setStatus] = useState("all");
  const [roomId, setRoomId] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusErrorId, setStatusErrorId] = useState<string | null>(null);
  const rooms = unique(requests.map((request) => ({ id: request.room.id, name: `${request.room.buildingName} · ${request.room.designation}` })));
  const employees = unique(requests.map((request) => ({ id: request.author.id, name: request.author.name })));
  const visible = useMemo(() => requests.filter((request) => {
    const created = request.createdAt.slice(0, 10);
    return (status === "all" || request.status === status) &&
      (roomId === "all" || request.room.id === roomId) &&
      (employeeId === "all" || request.author.id === employeeId) &&
      (!dateFrom || created >= dateFrom) && (!dateTo || created <= dateTo);
  }), [requests, status, roomId, employeeId, dateFrom, dateTo]);

  async function updateStatus(request: ServiceRequestDto, next: ServiceRequestStatus) {
    if (request.status === next || savingId === request.id) return;
    setSavingId(request.id);
    setStatusErrorId(null);
    setRequests((current) =>
      current.map((value) =>
        value.id === request.id ? { ...value, status: next } : value,
      ),
    );
    try {
      const response = await fetch(`/api/service-requests/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, version: request.version }),
      });
      const body = await response.json() as { request?: ServiceRequestDto };
      if (!response.ok || !body.request) throw new Error();
      setRequests((current) => current.map((value) => value.id === request.id ? body.request! : value));
    } catch {
      setRequests((current) =>
        current.map((value) => (value.id === request.id ? request : value)),
      );
      setStatusErrorId(request.id);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">{t("request.title")}</h1>
        <p className="mt-1 text-base text-zinc-500">{visible.length}</p>
      </div>
      {statusErrorId ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {t("request.statusUpdateFailed")}
        </p>
      ) : null}
      <section className="grid gap-3 rounded-2xl border border-black/5 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect label={t("items.status")} value={status} onChange={setStatus} options={[{ id: "all", name: t("request.allStatuses") }, ...(["new", "in_progress", "completed"] as const).map((value) => ({ id: value, name: t(`request.status.${value}`) }))]} />
        <FilterSelect label={t("itemDetails.room")} value={roomId} onChange={setRoomId} options={[{ id: "all", name: t("common.other") }, ...rooms]} />
        <FilterSelect label={t("request.author")} value={employeeId} onChange={setEmployeeId} options={[{ id: "all", name: t("common.other") }, ...employees]} />
        <DateFilter label={t("analytics.dateFrom")} value={dateFrom} onChange={setDateFrom} />
        <DateFilter label={t("analytics.dateTo")} value={dateTo} onChange={setDateTo} />
      </section>
      <div className="hidden overflow-x-auto rounded-2xl border border-black/5 bg-white md:block">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-black/5 text-xs uppercase tracking-wide text-zinc-500"><tr><th className="p-4">{t("request.type")}</th><th className="p-4">{t("request.problemItem")}</th><th className="p-4">{t("itemDetails.room")}</th><th className="p-4">{t("request.author")}</th><th className="p-4">{t("room.responsible")}</th><th className="p-4">{t("request.description")}</th><th className="p-4">{t("request.photo")}</th><th className="p-4">{t("items.status")}</th><th className="p-4">{t("request.updatedAt")}</th></tr></thead>
          <tbody>{visible.map((request) => <RequestRow key={request.id} request={request} canManage={canManage} saving={savingId === request.id} onStatus={updateStatus} locale={language === "kk" ? "kk-KZ" : language === "en" ? "en-US" : "ru-RU"} />)}</tbody>
        </table>
      </div>
      <div className="space-y-4 md:hidden">
        {visible.map((request) => <RequestCard key={request.id} request={request} canManage={canManage} saving={savingId === request.id} onStatus={updateStatus} />)}
      </div>
      {!visible.length ? <p className="rounded-2xl bg-white p-8 text-center text-zinc-500">{t("request.empty")}</p> : null}
    </div>
  );
}

function RequestRow({ request, canManage, saving, onStatus, locale }: { request: ServiceRequestDto; canManage: boolean; saving: boolean; onStatus(request: ServiceRequestDto, status: ServiceRequestStatus): void; locale: string }) {
  const { t } = useAppSettings();
  return <tr className="border-b border-black/5 align-top last:border-0"><td className="p-4 font-medium">{t(`request.type.${request.type}`)}</td><td className="p-4"><Link className="font-medium text-[#002060] hover:underline" href={`/items/${request.item.id}`}>{request.item.name}</Link><p className="text-xs text-zinc-500">{request.item.inventoryNumber}</p></td><td className="p-4">{request.room.buildingName} · {request.room.designation}</td><td className="p-4">{request.author.name}</td><td className="p-4">{request.responsible?.name ?? t("common.notAssigned")}</td><td className="max-w-xs p-4">{request.description}</td><td className="p-4"><Image src={request.photoUrl} alt={t("request.photo")} width={96} height={72} unoptimized className="h-16 w-24 rounded-lg object-cover" /></td><td className="p-4"><StatusControl request={request} canManage={canManage} saving={saving} onStatus={onStatus} /></td><td className="whitespace-nowrap p-4 text-zinc-500">{new Date(request.updatedAt).toLocaleString(locale)}</td></tr>;
}

function RequestCard({ request, canManage, saving, onStatus }: { request: ServiceRequestDto; canManage: boolean; saving: boolean; onStatus(request: ServiceRequestDto, status: ServiceRequestStatus): void }) {
  const { t } = useAppSettings();
  return <article className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm"><div className="relative aspect-[16/9]"><Image src={request.photoUrl} alt={t("request.photo")} fill sizes="100vw" unoptimized className="object-cover" /></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-amber-700">{t(`request.type.${request.type}`)}</p><Link href={`/items/${request.item.id}`} className="mt-1 block text-lg font-semibold text-zinc-900">{request.item.name}</Link><p className="text-sm text-zinc-500">{request.item.inventoryNumber}</p></div><StatusControl request={request} canManage={canManage} saving={saving} onStatus={onStatus} /></div><p className="mt-4 text-base leading-6 text-zinc-700">{request.description}</p><dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><dt className="text-zinc-500">{t("itemDetails.room")}</dt><dd className="text-right">{request.room.designation}</dd><dt className="text-zinc-500">{t("request.author")}</dt><dd className="text-right">{request.author.name}</dd><dt className="text-zinc-500">{t("room.responsible")}</dt><dd className="text-right">{request.responsible?.name ?? t("common.notAssigned")}</dd><dt className="text-zinc-500">{t("request.createdAt")}</dt><dd className="text-right">{new Date(request.createdAt).toLocaleDateString()}</dd></dl></div></article>;
}

function StatusControl({ request, canManage, saving, onStatus }: { request: ServiceRequestDto; canManage: boolean; saving: boolean; onStatus(request: ServiceRequestDto, status: ServiceRequestStatus): void }) {
  const { t } = useAppSettings();
  if (!canManage) return <span className="inline-flex min-h-8 items-center rounded-full bg-zinc-100 px-3 text-xs font-semibold text-zinc-700">{t(`request.status.${request.status}`)}</span>;
  return <select aria-label={t("items.status")} disabled={saving} value={request.status} onChange={(event) => onStatus(request, event.target.value as ServiceRequestStatus)} className="min-h-11 rounded-xl border border-zinc-200 bg-white px-2 text-sm font-semibold"><option value="new">{t("request.status.new")}</option><option value="in_progress">{t("request.status.in_progress")}</option><option value="completed">{t("request.status.completed")}</option></select>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange(value: string): void; options: Array<{ id: string; name: string }> }) { return <label className="text-sm text-zinc-600"><span className="mb-1 block">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base">{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>; }
function DateFilter({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) { return <label className="text-sm text-zinc-600"><span className="mb-1 block">{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-zinc-200 px-3 text-base" /></label>; }
function unique(values: Array<{ id: string; name: string }>) { return [...new Map(values.map((value) => [value.id, value])).values()]; }
