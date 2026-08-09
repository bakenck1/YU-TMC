"use client";

import Image from "next/image";
import { MapPin, Package, UserRound } from "lucide-react";
import { useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TmcTransferRequestDto } from "@/lib/contracts/tmc-operations";
import type { TranslationKey } from "@/lib/i18n";
import {
  createTmcRequestSelection,
  toggleTmcRequestSelection,
} from "@/lib/tmc-transfer-request-card";

const STATUS_KEYS = {
  pending: "tmc.request.status.pending",
  accepted: "tmc.request.status.accepted",
  rejected: "tmc.request.status.rejected",
  cancelled: "tmc.request.status.cancelled",
} as const satisfies Record<TmcTransferRequestDto["status"], TranslationKey>;

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-900",
  accepted: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-800",
  cancelled: "bg-zinc-100 text-zinc-700",
} as const satisfies Record<TmcTransferRequestDto["status"], string>;

const ITEM_RESULT_KEYS = {
  pending: "tmc.request.item.pending",
  accepted: "tmc.request.item.accepted",
  rejected: "tmc.request.item.rejected",
  cancelled: "tmc.request.item.cancelled",
  invalidated: "tmc.request.item.invalidated",
} as const satisfies Record<TmcTransferRequestDto["items"][number]["result"], TranslationKey>;

export default function TmcTransferRequestCard({
  request,
  canDecide,
  showOverdue,
}: {
  request: TmcTransferRequestDto;
  canDecide: boolean;
  showOverdue: boolean;
}) {
  const { t, language } = useAppSettings();
  const [selection, setSelection] = useState<ReadonlySet<string>>(() =>
    createTmcRequestSelection(request, canDecide),
  );
  const locale = language === "kk" ? "kk-KZ" : language === "en" ? "en-US" : "ru-RU";
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "KZT" });
  const createdAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Qyzylorda",
  }).format(new Date(request.createdAt));

  return (
    <section className="space-y-4" aria-labelledby="tmc-request-title">
      <header className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="tmc-request-title" className="text-2xl font-semibold text-zinc-900">{t("tmc.request.title")}</h1>
            <p className="mt-1 break-all text-xs text-zinc-500">{request.id}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLES[request.status]}`}>{t(STATUS_KEYS[request.status])}</span>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <Meta label={t("tmc.request.initiator")} value={`${request.initiator.fullName} · ${request.initiator.email}`} />
          <Meta label={t("tmc.request.recipient")} value={`${request.recipient.fullName} · ${request.recipient.email}`} />
          <div><dt className="font-medium text-zinc-500">{t("tmc.request.createdAt")}</dt><dd className="mt-1 text-zinc-900"><time dateTime={request.createdAt}>{createdAt}</time></dd></div>
          <Meta label={t("tmc.request.summary")} value={`${request.summary.pending} / ${request.summary.total}`} />
        </dl>
        {showOverdue && request.overdue ? <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">{t("tmc.request.overdue")}</p> : null}
        <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm">
          <p className="font-medium text-zinc-500">{t("tmc.request.comment")}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-zinc-800">{request.comment || t("tmc.request.noComment")}</p>
        </div>
      </header>

      <div className="space-y-3">
        {request.items.map((item, index) => {
          const selectable = canDecide && item.result === "pending";
          const checked = selectable && selection.has(item.id);
          const checkboxId = `tmc-request-item-${item.id}`;
          return (
            <article key={item.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <label htmlFor={checkboxId} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={checked}
                    disabled={!selectable}
                    aria-label={`${t("tmc.request.selectItem")} ${item.item.name}`}
                    onChange={() => setSelection((current) => toggleTmcRequestSelection(current, item, canDecide))}
                    className="h-5 w-5 accent-emerald-700"
                  />
                </label>
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                  {item.item.photoUrl ? (
                    <Image src={item.item.photoUrl} alt="" fill unoptimized className="object-cover" sizes="80px" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-zinc-400" aria-label={t("tmc.request.noPhoto")}><Package className="h-7 w-7" aria-hidden="true" /></span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="break-words font-semibold text-zinc-900">{index + 1}. {item.item.name}</h2>
                  <p className="mt-1 text-xs font-semibold text-zinc-600">{t(ITEM_RESULT_KEYS[item.result])}</p>
                  <p className="mt-1 break-all text-sm text-zinc-500">{item.item.inventoryNumber}</p>
                  <p className="mt-2 flex items-start gap-2 text-sm text-zinc-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{item.item.location.buildingName} · {item.item.location.roomDesignation}</p>
                  <p className="mt-2 flex items-start gap-2 text-sm text-zinc-700"><UserRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-words">{t("tmc.request.currentResponsible")}: {item.responsibleUserProfile.fullName}</span></p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 p-3 text-sm sm:grid-cols-3">
                <Meta label={t("tmc.request.quantity")} value={String(item.item.quantity)} />
                <Meta label={t("tmc.request.unitPrice")} value={money.format(item.item.unitPrice)} />
                <Meta label={t("tmc.request.totalPrice")} value={money.format(item.item.quantity * item.item.unitPrice)} />
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-medium text-zinc-500">{label}</dt><dd className="mt-1 break-words text-zinc-900">{value}</dd></div>;
}
