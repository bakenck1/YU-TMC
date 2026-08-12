import type { TmcTransferRequestCardView } from "@/lib/tmc-transfer-request-detail-view";
import type { TranslationKey } from "@/lib/i18n";
import { useAppSettings } from "./AppSettingsProvider";

type ItemResult = TmcTransferRequestCardView["items"][number]["result"];
const RESULT_KEYS = { pending: "tmc.request.item.pending", accepted: "tmc.request.item.accepted", rejected: "tmc.request.item.rejected", cancelled: "tmc.request.item.cancelled", invalidated: "tmc.request.item.invalidated" } as const satisfies Record<ItemResult, TranslationKey>;
const RESULT_STYLES = { pending: "bg-amber-100 text-amber-900 ring-amber-200", accepted: "bg-emerald-100 text-emerald-800 ring-emerald-200", rejected: "bg-red-100 text-red-800 ring-red-200", cancelled: "bg-zinc-100 text-zinc-700 ring-zinc-200", invalidated: "bg-red-100 text-red-800 ring-red-200" } as const satisfies Record<ItemResult, string>;

export default function TmcRequestItemResultBadge({ result }: { result: ItemResult }) {
  const { t } = useAppSettings();
  return <span className={`mt-1 inline-flex min-h-8 items-center rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${RESULT_STYLES[result]}`}>{t(RESULT_KEYS[result])}</span>;
}
