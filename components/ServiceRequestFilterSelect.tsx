export interface ServiceRequestFilterOption { id: string; name: string }
export interface ServiceRequestFilterSelectProps { label: string; value: string; onChange(value: string): void; options: ServiceRequestFilterOption[] }

export default function ServiceRequestFilterSelect({ label, value, onChange, options }: ServiceRequestFilterSelectProps) {
  return <label className="text-sm text-zinc-600"><span className="mb-1 block">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base">{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}
