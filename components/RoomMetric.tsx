import type { LucideIcon } from "lucide-react";

export default function RoomMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-2xl border border-black/5 bg-white p-3 text-center shadow-sm sm:p-4">
      <Icon className="mx-auto h-5 w-5 text-emerald-600" aria-hidden="true" />
      <p className="mt-2 text-xl font-bold text-zinc-900">{value}</p>
      <p className="mt-1 truncate text-xs text-zinc-500 sm:text-sm">{label}</p>
    </div>
  );
}
