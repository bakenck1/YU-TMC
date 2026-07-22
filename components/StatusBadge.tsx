import type { ItemStatus } from "@/lib/types";

const STATUS_CONFIG: Record<ItemStatus, { label: string; className: string }> = {
  active: {
    label: "Активен",
    className: "bg-green-100 text-green-700 ring-1 ring-inset ring-green-600/20",
  },
  maintenance: {
    label: "На обслуживании",
    className: "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  },
  decommissioned: {
    label: "Списано",
    className: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-500/20",
  },
};

export default function StatusBadge({ status }: { status: ItemStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${config.className}`}
    >
      {config.label}
    </span>
  );
}
