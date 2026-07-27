import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
}

export default function StatCard({ label, value, icon: Icon, hint }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-500">{label}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e6ecf7] text-[#002060]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900">
        {value}
      </div>
      {hint ? <p className="mt-1 text-xs text-zinc-400">{hint}</p> : null}
    </div>
  );
}
