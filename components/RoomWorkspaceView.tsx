"use client";

import Image from "next/image";
import Link from "next/link";
import { Cable, CircleUserRound, DoorOpen, ImageIcon, Layers3, Package } from "lucide-react";
import type { RoomWorkspaceDto } from "@/lib/contracts/room-workspace";
import { useAppSettings } from "@/components/AppSettingsProvider";
import ProblemReportButton from "@/components/ProblemReportButton";

export default function RoomWorkspaceView({
  room,
  authenticated,
  returnTo,
}: {
  room: RoomWorkspaceDto | { designation: string };
  authenticated: boolean;
  returnTo: string;
}) {
  const { t } = useAppSettings();
  if (!("access" in room)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-10">
        <section className="w-full rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <DoorOpen className="mx-auto h-12 w-12 text-emerald-600" />
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-emerald-700">{t("room.title")}</p>
          <h1 className="mt-2 text-2xl font-bold text-zinc-900">{room.designation}</h1>
          <p className="mt-3 text-base text-zinc-600">{t("room.publicHint")}</p>
          <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#002060] px-4 text-base font-semibold text-white">{t("room.login")}</Link>
        </section>
      </main>
    );
  }
  return (
    <main className={`mx-auto w-full max-w-5xl space-y-5 ${authenticated ? "pb-24 md:pb-6" : ""}`}>
      <section className="rounded-3xl bg-gradient-to-br from-[#002060] to-[#064b8e] p-5 text-white shadow-sm sm:p-7">
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-100">{t("room.title")}</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{room.designation}</h1>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-base text-blue-50">
          {room.buildingName ? <span className="flex items-center gap-2"><DoorOpen className="h-5 w-5" />{room.buildingName}</span> : null}
          {room.floorNumber !== undefined ? <span className="flex items-center gap-2"><Layers3 className="h-5 w-5" />{t("room.floor")}: {room.floorLabel ?? room.floorNumber}</span> : null}
          <span className="flex items-center gap-2"><CircleUserRound className="h-5 w-5" />{room.responsibleName ?? t("common.notAssigned")}</span>
        </div>
      </section>
      {room.access === "limited" ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-base text-amber-900">{t("room.noAccess")}</p>
      ) : (
        <>
          <section className="grid grid-cols-3 gap-3">
            <Metric icon={Package} label={t("room.itemCount")} value={room.itemCount ?? 0} />
            <Metric icon={Cable} label={t("room.connected")} value={room.connectedCount ?? 0} />
            <Metric icon={Cable} label={t("room.disconnected")} value={room.disconnectedCount ?? 0} />
          </section>
          {room.items.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {room.items.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
                  <Link href={`/items/${item.id}`} className="block">
                    <div className="relative flex aspect-[16/9] items-center justify-center bg-zinc-100">
                      {item.photoUrl ? <Image src={item.photoUrl} alt={item.name} fill sizes="(max-width: 640px) 100vw, 50vw" unoptimized className="object-cover" /> : <ImageIcon className="h-10 w-10 text-zinc-400" />}
                    </div>
                    <div className="p-4">
                      <h2 className="text-lg font-semibold text-zinc-900">{item.name}</h2>
                      <p className="mt-1 text-sm text-zinc-500">{item.inventoryNumber}</p>
                      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <dt className="text-zinc-500">{t("room.responsible")}</dt><dd className="text-right text-zinc-800">{item.responsibleName ?? room.responsibleName ?? t("common.notAssigned")}</dd>
                        <dt className="text-zinc-500">{t("items.status")}</dt><dd className="text-right text-zinc-800">{t(`status.${item.status}`)}</dd>
                        <dt className="text-zinc-500">{t("item.condition")}</dt><dd className="text-right text-zinc-800">{t(`condition.${item.condition}`)}</dd>
                        <dt className="text-zinc-500">{t("room.connected")}</dt><dd className="text-right text-zinc-800">{t(`connection.${item.connectionStatus}`)}</dd>
                      </dl>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : <p className="rounded-2xl bg-white p-6 text-center text-zinc-500">{t("room.empty")}</p>}
          <ProblemReportButton items={room.items} className="w-full" />
        </>
      )}
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: number }) {
  return <div className="min-w-0 rounded-2xl border border-black/5 bg-white p-3 text-center shadow-sm sm:p-4"><Icon className="mx-auto h-5 w-5 text-emerald-600" /><p className="mt-2 text-xl font-bold text-zinc-900">{value}</p><p className="mt-1 truncate text-xs text-zinc-500 sm:text-sm">{label}</p></div>;
}
