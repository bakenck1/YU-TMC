"use client";

import Link from "next/link";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TmcOperationItemOutcomeDto, TmcTransferRequestCreationItemOutcomeDto } from "@/lib/contracts/tmc-operations";
import type { TranslationKey } from "@/lib/i18n";
import type { InventoryItem } from "@/lib/types";

type TmcOperationOutcome = TmcTransferRequestCreationItemOutcomeDto | TmcOperationItemOutcomeDto;

interface TmcOperationResultsProps {
  items: InventoryItem[];
  outcomes: TmcOperationOutcome[];
  requestId: string | null;
}

export default function TmcOperationResults({ items, outcomes, requestId }: TmcOperationResultsProps) {
  const { t } = useAppSettings();
  const itemById = new Map(items.map((item) => [item.id, item]));

  return (
    <div className="mt-5 rounded-2xl border border-black/5 p-4">
      <h3 className="font-semibold text-zinc-900">{t("tmc.bulk.results")}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {outcomes.map((outcome) => (
          <li key={outcome.itemId} className="flex justify-between gap-4">
            <span>{itemById.get(outcome.itemId)?.name ?? outcome.itemId}</span>
            <span className={outcome.outcome === "problem" ? "text-rose-700" : "text-emerald-700"}>
              {outcome.outcome === "problem"
                ? t(`tmc.problem.${outcome.problem}` as TranslationKey)
                : t("tmc.bulk.success")}
            </span>
          </li>
        ))}
      </ul>
      {requestId ? (
        <Link href={`/tmc/transfer-requests/${requestId}`} className="mt-4 inline-flex font-semibold text-emerald-700 hover:underline">
          {t("tmc.bulk.openRequest")}
        </Link>
      ) : null}
    </div>
  );
}
