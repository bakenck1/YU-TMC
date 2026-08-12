import type { TmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";
import type { TranslationKey } from "@/lib/i18n";
import { useAppSettings } from "./AppSettingsProvider";

const STATUS_KEYS = { pending: "tmc.request.status.pending", accepted: "tmc.request.status.accepted", rejected: "tmc.request.status.rejected", cancelled: "tmc.request.status.cancelled" } as const satisfies Record<TmcTransferRequestCardView["status"], TranslationKey>;
const STATUS_STYLES = { pending: "bg-amber-50 text-amber-900", accepted: "bg-emerald-50 text-emerald-800", rejected: "bg-red-50 text-red-800", cancelled: "bg-zinc-100 text-zinc-700" } as const satisfies Record<TmcTransferRequestCardView["status"], string>;

export default function TmcRequestStatusBadge({ status }: { status: TmcTransferRequestCardView["status"] }) {
  const { t } = useAppSettings();
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLES[status]}`}>{t(STATUS_KEYS[status])}</span>;
}
