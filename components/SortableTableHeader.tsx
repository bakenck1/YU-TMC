import { ChevronDown, ChevronUp } from "lucide-react";

export interface SortableTableHeaderProps<TKey extends string> {
  label: string;
  sortKey: TKey;
  activeKey: TKey;
  direction: "asc" | "desc";
  onSort: (key: TKey) => void;
}

export default function SortableTableHeader<TKey extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: SortableTableHeaderProps<TKey>) {
  const active = activeKey === sortKey;
  const Icon = direction === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${active ? "text-zinc-700" : "text-zinc-400 hover:text-zinc-600"}`}
    >
      {label}
      {active ? <Icon className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <span className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}
