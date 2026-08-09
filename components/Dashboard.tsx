"use client";

import Link from "next/link";
import { ArrowLeftRight, Boxes, MapPin, TriangleAlert, Users } from "lucide-react";

import CampusMap from "@/components/CampusMap";
import StatCard from "@/components/StatCard";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { CampusMapData } from "@/lib/campus-map-data";
import { TMC_ENTRY_POINT } from "@/lib/tmc-navigation";

export default function Dashboard({
  totalUsers,
  campus,
  isEmployee,
}: {
  totalUsers: number;
  campus: CampusMapData;
  isEmployee?: boolean;
}) {
  const { t } = useAppSettings();
  return (
    <div className="space-y-6">
      <Link
        href={TMC_ENTRY_POINT.href}
        className="group flex min-h-14 w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-emerald-950 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:w-fit sm:min-w-72"
      >
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm transition group-hover:scale-105"
        >
          <ArrowLeftRight className="h-5 w-5" />
        </span>
        <span className="min-w-0 break-words text-base font-semibold">
          {t(TMC_ENTRY_POINT.labelKey)}
        </span>
      </Link>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("dashboard.totalItems")} value={campus.totals.units} icon={Boxes} hint={t("dashboard.allBuildings")} />
        <StatCard label={t("dashboard.locations")} value={campus.totals.locations} icon={MapPin} hint={t("dashboard.universityBuildings")} />
        <StatCard
          label={t("dashboard.needsAttention")}
          value={campus.totals.attention}
          icon={TriangleAlert}
          hint={t("dashboard.maintenance")}
        />
        {!isEmployee ? <StatCard label={t("dashboard.users")} value={totalUsers} icon={Users} hint={t("dashboard.inSystem")} /> : null}
      </div>

      <CampusMap data={campus} />
    </div>
  );
}
