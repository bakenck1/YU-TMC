"use client";

import { Boxes, MapPin, TriangleAlert, Users } from "lucide-react";

import CampusMap from "@/components/CampusMap";
import StatCard from "@/components/StatCard";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { CampusMapData } from "@/lib/campus-map-data";

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
