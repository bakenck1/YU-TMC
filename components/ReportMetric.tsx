export default function ReportMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-zinc-400">{label}</p><p className="mt-1 font-semibold text-zinc-800">{value}</p></div>;
}
