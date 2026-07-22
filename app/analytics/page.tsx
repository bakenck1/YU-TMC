import { Boxes, MapPin, TriangleAlert, Users } from "lucide-react";
import StatCard from "@/components/StatCard";
import AnalyticsCharts from "@/components/AnalyticsCharts";
import {
  categoryDistribution,
  dashboardStats,
  monthlyDynamics,
  statusDistribution,
} from "@/lib/data";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Всего ТМЦ" value={dashboardStats.totalItems} icon={Boxes} />
        <StatCard label="Локаций" value={dashboardStats.totalLocations} icon={MapPin} />
        <StatCard label="Требуют внимания" value={dashboardStats.needsAttention} icon={TriangleAlert} />
        <StatCard label="Пользователей" value={dashboardStats.totalUsers} icon={Users} />
      </div>

      <AnalyticsCharts
        categoryDistribution={categoryDistribution}
        monthlyDynamics={monthlyDynamics}
        statusDistribution={statusDistribution}
      />
    </div>
  );
}
