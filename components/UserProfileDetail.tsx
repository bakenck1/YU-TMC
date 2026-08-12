import type { LucideIcon } from "lucide-react";

export interface UserProfileDetailProps {
  icon: LucideIcon;
  label: string;
  value: string;
  valueFormat?: "text" | "code";
}

export default function UserProfileDetail({ icon: Icon, label, value, valueFormat = "text" }: UserProfileDetailProps) {
  return (
    <div className="group rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4 transition-colors hover:border-blue-100 hover:bg-blue-50/40">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
        <Icon className="h-4 w-4 text-zinc-400 transition-colors group-hover:text-[#06458a]" aria-hidden="true" />
        {label}
      </dt>
      <dd className={`mt-3 break-words text-sm font-semibold text-zinc-900 ${valueFormat === "code" ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
