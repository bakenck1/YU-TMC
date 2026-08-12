export interface DateFilterFieldProps { label: string; value: string; onChange(value: string): void; min?: string; max?: string }

export default function DateFilterField({ label, value, onChange, min, max }: DateFilterFieldProps) {
  return <label className="text-sm text-zinc-600"><span className="mb-1 block">{label}</span><input type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-zinc-200 px-3 text-base" /></label>;
}
