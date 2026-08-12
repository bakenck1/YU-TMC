import type { LucideIcon } from "lucide-react";

interface AnalyticsSummaryCardProps {
  label: string;
  value: string;
  hint: string;
  progress: number;
  icon: LucideIcon;
}

export default function AnalyticsSummaryCard({
  label,
  value,
  hint,
  progress,
  icon: Icon,
}: AnalyticsSummaryCardProps) {
  const safeProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="flex flex-col items-center rounded-2xl border border-black/5 bg-white p-5 text-center shadow-sm">
      <div
        className="relative flex h-32 w-32 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(#16a34a ${safeProgress * 3.6}deg, #e4e4e7 0deg)` }}
      >
        <div className="flex h-[104px] w-[104px] flex-col items-center justify-center rounded-full bg-white">
          <Icon className="mb-1 h-5 w-5 text-emerald-600" aria-hidden="true" />
          <strong className="text-xl tracking-tight text-zinc-900">{value}</strong>
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold text-zinc-800">{label}</p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}
