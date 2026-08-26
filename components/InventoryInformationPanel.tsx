"use client";

import type { InventoryItemOperationDto } from "@/lib/contracts/inventory-items";
import { useAppSettings } from "./AppSettingsProvider";
import { operationDetail, operationTitle } from "./InventoryItemDetailsPresentation";

export default function InventoryInformationPanel({
  operations = [],
}: {
  operations?: InventoryItemOperationDto[];
}) {
  const { locale, t } = useAppSettings();

  return (
    <section aria-labelledby="legacy-item-operations-title" className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <h2 id="legacy-item-operations-title" className="mb-6 text-lg font-semibold text-zinc-800">
        {t("itemDetails.recentOperations")}
      </h2>
      {operations.length ? (
        <ol className="relative space-y-3 border-l border-emerald-200 pl-4">
          {operations.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="relative rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <span className="absolute -left-[1.35rem] top-5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" aria-hidden="true" />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-zinc-800">{operationTitle(entry, t)}</p>
                <time className="text-xs text-zinc-400" dateTime={entry.occurredAt}>
                  {new Date(entry.occurredAt).toLocaleString(locale)}
                </time>
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                {entry.actorName ?? t("itemDetails.auditUnknownActor")}
                {entry.actorEmail ? ` · ${entry.actorEmail}` : ""}
                {operationDetail(entry, t)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-sm text-zinc-500">
          {t("itemDetails.operationsEmpty")}
        </p>
      )}
    </section>
  );
}
