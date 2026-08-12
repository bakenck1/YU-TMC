import type { ChangeEventHandler } from "react";

export interface CheckboxFieldProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  name?: string;
}

export default function CheckboxField({ label, hint, checked, onChange, disabled = false, name }: CheckboxFieldProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent p-2 transition hover:border-zinc-200 hover:bg-white has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <input name={name} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 h-4 w-4 accent-emerald-600" />
      <span>
        <span className="block text-sm font-medium text-zinc-700">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-zinc-400">{hint}</span> : null}
      </span>
    </label>
  );
}
