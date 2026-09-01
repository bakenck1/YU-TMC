"use client";

import { Download, Printer } from "lucide-react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { LocalBarcodeGroupDto } from "@/lib/contracts/local-barcodes";

export default function LocalBarcodeTransferResult({
  groups,
}: {
  groups: LocalBarcodeGroupDto[];
}) {
  const { t } = useAppSettings();

  return (
    <div className="mt-5 space-y-3" aria-live="polite">
      <p className="font-semibold text-emerald-900">
        {t("tmc.localBarcode.created")}
      </p>
      <p className="text-sm text-zinc-600">
        {t("tmc.localBarcode.assignedImmediately")}
      </p>
      {groups.map((group) => (
        <article
          key={group.id}
          className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4"
        >
          <p className="text-sm text-zinc-600">
            {group.itemName} · {group.quantity} {t("common.piecesShort")}
          </p>
          <strong className="mt-1 block font-mono text-base text-emerald-950">
            {group.localBarcode}
          </strong>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/api/inventory/local-barcodes/${group.id}/label?download=1`}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-900"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("tmc.localBarcode.downloadLabel")}
            </a>
            <a
              href={`/local-barcodes/${group.id}/label`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-900"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              {t("tmc.localBarcode.printLabel")}
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
