export default function TmcRequestMeta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-medium text-zinc-500">{label}</dt><dd className="mt-1 break-words text-zinc-900">{value}</dd></div>;
}
