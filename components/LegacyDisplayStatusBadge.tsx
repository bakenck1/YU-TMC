import { useAppSettings } from "./AppSettingsProvider";

export default function LegacyDisplayStatusBadge({ value }: { value: string }) {
  const { dataLabel } = useAppSettings();
  const styles = value === "Не распределено" ? "bg-zinc-100 text-zinc-500" : value === "Маркировано" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-600";
  return <span className={`inline-block rounded px-2 py-1 text-xs font-medium ${styles}`}>{dataLabel(value)}</span>;
}
