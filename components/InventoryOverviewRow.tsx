export default function InventoryOverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 py-2">
      <dt className="font-medium text-zinc-700">{label}</dt>
      <dd className="text-right text-zinc-600">{value}</dd>
    </div>
  );
}
