import type { InspectionDto } from "@/lib/contracts/inventory-inspections";
import { useAppSettings } from "./AppSettingsProvider";

export default function InspectionProgress({ inspection }: { inspection: InspectionDto }) {
  const { t } = useAppSettings();
  const { checked: completed, total, percent } = inspection.progress;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{t("inspections.progress")}</span>
        <span>{t("inspections.progressItems", { completed, total })} · {percent}%</span>
      </div>
      <div role="progressbar" aria-label={t("inspections.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
