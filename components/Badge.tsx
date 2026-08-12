import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type BadgeTone = "neutral" | "success" | "danger" | "warning" | "info" | "accent";
type BadgeSize = "sm" | "md";
type BadgeShape = "pill" | "soft";

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  shape?: BadgeShape;
  icon?: LucideIcon;
}

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  danger: "bg-red-50 text-red-600 ring-red-600/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  info: "bg-sky-100 text-sky-700 ring-sky-600/20",
  accent: "bg-accent-light text-accent ring-accent/20",
};

export default function Badge({ children, tone = "neutral", size = "md", shape = "pill", icon: Icon }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 font-medium ring-1 ring-inset ${shape === "pill" ? "rounded-full" : "rounded-md"} ${size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"} ${TONES[tone]}`}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
