"use client";

import { useAppSettings } from "@/components/AppSettingsProvider";
import { statusMeta, type CampusStatus } from "@/lib/campus";
import type { TranslationKey } from "@/lib/i18n";

type CampusItemStatusBadgeVariant = "compact" | "card";

interface CampusItemStatusBadgeProps {
  status: CampusStatus;
  variant?: CampusItemStatusBadgeVariant;
}

const STATUS_KEYS: Record<CampusStatus, { compact: TranslationKey; card: TranslationKey }> = {
  ok: { compact: "map.status.ok", card: "map.statusCard.ok" },
  check: { compact: "map.status.check", card: "map.statusCard.check" },
  service: { compact: "map.status.service", card: "map.statusCard.service" },
  writeoff: { compact: "map.status.writeoff", card: "map.statusCard.writeoff" },
};

export default function CampusItemStatusBadge({ status, variant = "compact" }: CampusItemStatusBadgeProps) {
  const { t } = useAppSettings();
  const statusStyle = statusMeta(status);

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-bold ${variant === "card" ? "mt-4 gap-2 px-3.5 py-2 text-xs" : "gap-1.5 px-2.5 py-1 text-[11px]"}`}
      style={{ color: statusStyle.color, background: statusStyle.bg }}
    >
      <span className={variant === "card" ? "h-2 w-2 rounded-full" : "h-1.5 w-1.5 rounded-full"} style={{ background: statusStyle.color }} />
      {t(STATUS_KEYS[status][variant])}
    </span>
  );
}
