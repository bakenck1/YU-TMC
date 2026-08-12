"use client";

import { useMemo, useState } from "react";
import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import type { ServiceRequestStatus } from "@/lib/contracts/inventory-domain";
import { useAppSettings } from "@/components/AppSettingsProvider";
import DateFilterField from "./DateFilterField";
import ServiceRequestCard from "./ServiceRequestCard";
import ServiceRequestFilterSelect from "./ServiceRequestFilterSelect";
import ServiceRequestTableRow from "./ServiceRequestTableRow";

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
  const rooms = unique(requests.map((request) => ({ id: request.room.id, name: `${request.room.buildingName} В· ${request.room.designation}` })));
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
        <ServiceRequestFilterSelect label={t("items.status")} value={status} onChange={setStatus} options={[{ id: "all", name: t("request.allStatuses") }, ...(["new", "in_progress", "completed"] as const).map((value) => ({ id: value, name: t(`request.status.${value}`) }))]} />
        <ServiceRequestFilterSelect label={t("itemDetails.room")} value={roomId} onChange={setRoomId} options={[{ id: "all", name: t("common.other") }, ...rooms]} />
        <ServiceRequestFilterSelect label={t("request.author")} value={employeeId} onChange={setEmployeeId} options={[{ id: "all", name: t("common.other") }, ...employees]} />
        <DateFilterField label={t("analytics.dateFrom")} value={dateFrom} max={dateTo || undefined} onChange={setDateFrom} />
        <DateFilterField label={t("analytics.dateTo")} value={dateTo} min={dateFrom || undefined} onChange={setDateTo} />
      </section>
      <div className="hidden overflow-x-auto rounded-2xl border border-black/5 bg-white md:block">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-black/5 text-xs uppercase tracking-wide text-zinc-500"><tr><th className="p-4">{t("request.type")}</th><th className="p-4">{t("request.problemItem")}</th><th className="p-4">{t("itemDetails.room")}</th><th className="p-4">{t("request.author")}</th><th className="p-4">{t("room.responsible")}</th><th className="p-4">{t("request.description")}</th><th className="p-4">{t("request.photo")}</th><th className="p-4">{t("items.status")}</th><th className="p-4">{t("request.updatedAt")}</th></tr></thead>
          <tbody>{visible.map((request) => <ServiceRequestTableRow key={request.id} request={request} canManage={canManage} saving={savingId === request.id} onStatus={updateStatus} locale={language === "kk" ? "kk-KZ" : language === "en" ? "en-US" : "ru-RU"} />)}</tbody>
        </table>
      </div>
      <div className="space-y-4 md:hidden">
        {visible.map((request) => <ServiceRequestCard key={request.id} request={request} canManage={canManage} saving={savingId === request.id} onStatus={updateStatus} />)}
      </div>
      {!visible.length ? <p className="rounded-2xl bg-white p-8 text-center text-zinc-500">{t("request.empty")}</p> : null}
    </div>
  );
}

function unique(values: Array<{ id: string; name: string }>) { return [...new Map(values.map((value) => [value.id, value])).values()]; }
