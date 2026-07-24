"use client";

import type { ItemStatus } from "@/lib/types";
import { useAppSettings } from "./AppSettingsProvider";
import type { TranslationKey } from "@/lib/i18n";

const STATUS_CONFIG: Record<ItemStatus, { labelKey: TranslationKey; className: string }> = {
  active: {
    labelKey: "status.active",
    className: "bg-green-100 text-green-700 ring-1 ring-inset ring-green-600/20",
  },
  maintenance: {
    labelKey: "status.maintenance",
    className: "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  },
  decommissioned: {
    labelKey: "status.decommissioned",
    className: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-500/20",
  },
};

export default function StatusBadge({ status }: { status: ItemStatus }) {
  const { t } = useAppSettings();
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${config.className}`}
    >
      {t(config.labelKey)}
    </span>
  );
}
