"use client";

import { Boxes, MapPin, TriangleAlert, Users } from "lucide-react";

import CampusMap from "@/components/CampusMap";
import StatCard from "@/components/StatCard";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { campusTotals } from "@/lib/campus";

export default function Dashboard({ totalUsers }: { totalUsers: number }) {
  const { t } = useAppSettings();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("dashboard.totalItems")} value={campusTotals.units} icon={Boxes} hint={t("dashboard.allBuildings")} />
        <StatCard label={t("dashboard.locations")} value={campusTotals.locations} icon={MapPin} hint={t("dashboard.universityBuildings")} />
        <StatCard
          label={t("dashboard.needsAttention")}
          value={campusTotals.attn}
          icon={TriangleAlert}
          hint={t("dashboard.maintenance")}
        />
        <StatCard label={t("dashboard.users")} value={totalUsers} icon={Users} hint={t("dashboard.inSystem")} />
      </div>

      <CampusMap />
    </div>
  );
}
