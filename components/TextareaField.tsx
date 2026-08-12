import type { TextareaHTMLAttributes } from "react";

export interface TextareaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "style"> {
  label: string;
  hint?: string;
  resize?: "none" | "vertical";
}

export default function TextareaField({ label, hint, resize = "vertical", id, ...textareaProps }: TextareaFieldProps) {
  const textareaId = id ?? textareaProps.name;
  return (
    <label className="block text-sm font-medium text-zinc-700" htmlFor={textareaId}>
      <span className="block">{label}</span>
      <textarea
        {...textareaProps}
        id={textareaId}
        className={`mt-1.5 min-h-24 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60 ${resize === "none" ? "resize-none" : "resize-y"}`}
      />
      {hint ? <span className="mt-1.5 block text-xs font-normal text-zinc-400">{hint}</span> : null}
    </label>
  );
}
