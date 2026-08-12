import type { ServiceRequestDto } from "@/lib/contracts/service-requests";
import type { ServiceRequestStatus } from "@/lib/contracts/inventory-domain";
import { useAppSettings } from "./AppSettingsProvider";

export interface ServiceRequestStatusControlProps {
  request: ServiceRequestDto;
  canManage: boolean;
  saving: boolean;
  onStatus(request: ServiceRequestDto, status: ServiceRequestStatus): void;
}

export default function ServiceRequestStatusControl({ request, canManage, saving, onStatus }: ServiceRequestStatusControlProps) {
  const { t } = useAppSettings();
  if (!canManage) return <span className="inline-flex min-h-8 items-center rounded-full bg-zinc-100 px-3 text-xs font-semibold text-zinc-700">{t(`request.status.${request.status}`)}</span>;
  return <select aria-label={t("items.status")} disabled={saving} value={request.status} onChange={(event) => onStatus(request, event.target.value as ServiceRequestStatus)} className="min-h-11 rounded-xl border border-zinc-200 bg-white px-2 text-sm font-semibold"><option value="new">{t("request.status.new")}</option><option value="in_progress">{t("request.status.in_progress")}</option><option value="completed">{t("request.status.completed")}</option></select>;
}
