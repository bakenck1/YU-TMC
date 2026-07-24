"use client";

import { Boxes, MapPin, TriangleAlert, Users } from "lucide-react";
import StatCard from "@/components/StatCard";
import { dashboardStats } from "@/lib/data";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function Home() {
  const { t } = useAppSettings();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("dashboard.totalItems")} value={dashboardStats.totalItems} icon={Boxes} hint={t("dashboard.allBuildings")} />
        <StatCard label={t("dashboard.locations")} value={dashboardStats.totalLocations} icon={MapPin} hint={t("dashboard.universityBuildings")} />
        <StatCard
          label={t("dashboard.needsAttention")}
          value={dashboardStats.needsAttention}
          icon={TriangleAlert}
          hint={t("dashboard.maintenance")}
        />
        <StatCard label={t("dashboard.users")} value={dashboardStats.totalUsers} icon={Users} hint={t("dashboard.inSystem")} />
      </div>

      <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/10 bg-white text-zinc-400 sm:h-96">
        <MapPin className="h-8 w-8" />
        <p className="text-sm font-medium">{t("dashboard.mapSoon")}</p>
      </div>
    </div>
  );
}
