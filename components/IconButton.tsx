import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

type IconButtonVariant = "ghost" | "outline" | "danger" | "primary";
type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "className" | "style"> {
  label: string;
  icon: LucideIcon;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700",
  outline: "border border-zinc-200 text-zinc-600 hover:bg-zinc-50",
  danger: "text-red-600 hover:bg-red-50",
  primary: "bg-emerald-600 text-white hover:bg-emerald-700",
};

const SIZES: Record<IconButtonSize, string> = {
  sm: "h-8 w-8 rounded-lg",
  md: "h-10 w-10 rounded-lg",
  lg: "h-11 w-11 rounded-xl",
};

export default function IconButton({ label, icon: Icon, variant = "ghost", size = "md", type = "button", ...buttonProps }: IconButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]}`}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} aria-hidden="true" />
    </button>
  );
}
