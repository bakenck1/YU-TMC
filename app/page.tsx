import { Boxes, MapPin, TriangleAlert, Users } from "lucide-react";
import StatCard from "@/components/StatCard";
import { dashboardStats } from "@/lib/data";

export default function Home() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Всего ТМЦ" value={dashboardStats.totalItems} icon={Boxes} hint="по всем корпусам" />
        <StatCard label="Локаций" value={dashboardStats.totalLocations} icon={MapPin} hint="корпуса университета" />
        <StatCard
          label="Требуют внимания"
          value={dashboardStats.needsAttention}
          icon={TriangleAlert}
          hint="на обслуживании"
        />
        <StatCard label="Пользователей" value={dashboardStats.totalUsers} icon={Users} hint="в системе" />
      </div>

      <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/10 bg-white text-zinc-400 sm:h-96">
        <MapPin className="h-8 w-8" />
        <p className="text-sm font-medium">Карта кампуса — скоро</p>
      </div>
    </div>
  );
}
