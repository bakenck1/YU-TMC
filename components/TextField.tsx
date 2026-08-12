import type { InputHTMLAttributes } from "react";
import { X, type LucideIcon } from "lucide-react";
import IconButton from "./IconButton";

type TextFieldSize = "sm" | "md" | "lg";
type TextFieldVariant = "default" | "muted";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "style" | "size"> {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  leadingIcon?: LucideIcon;
  onClear?: () => void;
  clearLabel?: string;
  fieldSize?: TextFieldSize;
  variant?: TextFieldVariant;
}

const SIZES: Record<TextFieldSize, string> = {
  sm: "h-8 rounded-lg px-3 text-sm",
  md: "h-10 rounded-xl px-3.5 text-sm",
  lg: "h-11 rounded-xl px-3.5 text-sm",
};

export default function TextField({
  label,
  hideLabel = false,
  hint,
  leadingIcon: LeadingIcon,
  onClear,
  clearLabel = "Clear",
  fieldSize = "lg",
  variant = "default",
  readOnly,
  disabled,
  value,
  id,
  ...inputProps
}: TextFieldProps) {
  const inputId = id ?? inputProps.name;
  const hasValue = typeof value === "string" && value.length > 0;
  return (
    <label className={`block min-w-0 ${hideLabel ? "relative" : "text-sm font-medium text-zinc-700"}`} htmlFor={inputId}>
      <span className={hideLabel ? "sr-only" : "block"}>{label}</span>
      <span className={`relative block ${hideLabel ? "" : "mt-1.5"}`}>
        {LeadingIcon ? <LeadingIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" /> : null}
        <input
          {...inputProps}
          id={inputId}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          className={`w-full border border-zinc-200 text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60 ${SIZES[fieldSize]} ${variant === "muted" ? "bg-zinc-50/60" : "bg-white"} ${readOnly ? "bg-zinc-50 text-zinc-500" : ""} ${LeadingIcon ? "pl-10" : ""} ${onClear && hasValue ? "pr-11" : ""}`}
        />
        {onClear && hasValue ? (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
            <IconButton label={clearLabel} icon={X} size="sm" onClick={onClear} />
          </span>
        ) : null}
      </span>
      {hint ? <span className="mt-1.5 block text-xs font-normal text-zinc-400">{hint}</span> : null}
    </label>
  );
}
