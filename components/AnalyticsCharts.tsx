"use client";

import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#16a34a", "#0ea5e9", "#f59e0b", "#7c3aed", "#0891b2", "#a16207"];
const STATUS_COLORS = ["#16a34a", "#f59e0b", "#a1a1aa"];

interface AnalyticsChartsProps {
  categoryDistribution: { name: string; value: number }[];
  monthlyDynamics: { month: string; added: number; decommissioned: number }[];
  statusDistribution: { name: string; value: number }[];
}

export default function AnalyticsCharts({
  categoryDistribution,
  monthlyDynamics,
  statusDistribution,
}: AnalyticsChartsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-black/5 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">Техника по категориям</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={categoryDistribution}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={2}
              >
                {categoryDistribution.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">Статусы техники</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={statusDistribution}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={2}
              >
                {statusDistribution.map((entry, index) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white p-4 lg:col-span-2">
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">Динамика по месяцам</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyDynamics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="month" stroke="#a1a1aa" fontSize={12} />
              <YAxis stroke="#a1a1aa" fontSize={12} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="added" name="Добавлено" stroke="#16a34a" strokeWidth={2} />
              <Line
                type="monotone"
                dataKey="decommissioned"
                name="Списано"
                stroke="#f59e0b"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
