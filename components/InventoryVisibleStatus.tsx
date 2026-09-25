import type { VisibleItemStatus } from "@/lib/inventory-list";
import LegacyDisplayStatusBadge from "./LegacyDisplayStatusBadge";
import StatusBadge from "./StatusBadge";
import { useAppSettings } from "./AppSettingsProvider";

export default function InventoryVisibleStatus({ status, isProject = false }: { status: VisibleItemStatus; isProject?: boolean }) {
  const { t } = useAppSettings();
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    {status.kind === "display" ? <LegacyDisplayStatusBadge value={status.value} /> : <StatusBadge status={status.value} />}
    {isProject ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-300">{t("status.project")}</span> : null}
  </span>;
}
