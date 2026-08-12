import type { LucideIcon } from "lucide-react";

interface AnalyticsDetailMetricProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

export default function AnalyticsDetailMetric({ icon: Icon, label, value }: AnalyticsDetailMetricProps) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Icon className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-zinc-900">{value}</p>
    </div>
  );
}
