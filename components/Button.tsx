import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-secondary" | "warning" | "warning-primary" | "ghost" | "filter" | "text";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  active?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
  count?: number;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
  secondary: "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  "danger-secondary": "border border-red-200 bg-white text-red-600 hover:bg-red-50",
  warning: "border border-amber-300 bg-white text-amber-800 hover:bg-amber-100",
  "warning-primary": "bg-amber-500 text-white shadow-sm hover:bg-amber-600",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800",
  filter: "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
  text: "text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 rounded-lg px-3 text-xs",
  md: "min-h-10 rounded-xl px-4 text-sm",
  lg: "min-h-11 rounded-xl px-5 text-sm",
};

export default function Button({
  children,
  variant = "secondary",
  size = "md",
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  active = false,
  fullWidth = false,
  loading = false,
  count,
  disabled,
  type = "button",
  ...buttonProps
}: ButtonProps) {
  const variantClass = variant === "filter" && active
    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
    : VARIANTS[variant];
  return (
    <button
      {...buttonProps}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${SIZES[size]} ${variantClass} ${fullWidth ? "w-full" : "w-auto"}`}
    >
      {LeadingIcon ? <LeadingIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> : null}
      {children}
      {count !== undefined && count > 0 ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-medium text-white">
          {count}
        </span>
      ) : null}
      {TrailingIcon ? <TrailingIcon className="h-4 w-4" aria-hidden="true" /> : null}
    </button>
  );
}
