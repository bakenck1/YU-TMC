import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "className" | "style" | "size"> {
  label: string;
  options: readonly SelectOption[];
  hideLabel?: boolean;
  fieldSize?: "sm" | "md" | "lg";
}

export default function SelectField({ label, options, hideLabel = false, fieldSize = "md", id, ...selectProps }: SelectFieldProps) {
  const selectId = id ?? selectProps.name;
  const sizeClass = fieldSize === "sm" ? "h-8 rounded-lg px-2 text-sm" : fieldSize === "lg" ? "h-11 rounded-xl px-3.5 text-sm" : "h-10 rounded-xl px-3 text-sm";
  return (
    <label className={hideLabel ? "block" : "block text-xs font-medium text-zinc-500"} htmlFor={selectId}>
      <span className={hideLabel ? "sr-only" : "block"}>{label}</span>
      <select
        {...selectProps}
        id={selectId}
        className={`w-full border border-zinc-200 bg-white text-zinc-700 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60 ${sizeClass} ${hideLabel ? "" : "mt-1.5"}`}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
