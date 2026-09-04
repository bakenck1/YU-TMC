"use client";

import { Barcode, ImageIcon, MapPin, Maximize2, UserRound, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import type { TranslationKey } from "@/lib/i18n";

type ScannedItem = NonNullable<QrResolutionDto["target"]> & { kind: "item" };

export default function ScannedItemDetailsCard({
  item,
  actions,
}: {
  item: ScannedItem;
  actions?: ReactNode;
}) {
  const { dataLabel, locale, t } = useAppSettings();
  const [photoOpen, setPhotoOpen] = useState(false);
  const details = item.itemDetails;
  const location = [item.buildingName, item.roomDesignation]
    .filter(Boolean)
    .join(" · ");
  const notSpecified = t("common.notSpecified");

  useEffect(() => {
    if (!photoOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhotoOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [photoOpen]);

  return (
    <>
      <article
        className="mt-5 overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-[0_18px_55px_-35px_rgba(15,23,42,0.45)]"
        aria-live="polite"
      >
        <div className="grid items-start md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="h-full border-b border-zinc-100 bg-zinc-50/80 p-4 md:border-b-0 md:border-r md:p-5">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-zinc-200 bg-[radial-gradient(circle_at_top,#ffffff_0%,#f4f4f5_72%)] shadow-inner md:aspect-square">
              {details?.photoUrl ? (
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  aria-label={t("itemDetails.openPhoto")}
                  className="group absolute inset-0 cursor-zoom-in overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-emerald-600"
                >
                  <Image
                    src={details.photoUrl}
                    alt={item.title}
                    fill
                    sizes="(min-width: 768px) 240px, 100vw"
                    unoptimized
                    className="object-contain p-2 transition duration-300 group-hover:scale-[1.03]"
                  />
                  <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-zinc-950/80 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm">
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("itemDetails.openPhoto")}
                  </span>
                </button>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-zinc-400">
                  <ImageIcon className="h-10 w-10" aria-hidden="true" />
                  {t("items.photoMissing")}
                </div>
              )}
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Barcode className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-zinc-950">{item.title}</h2>
                  {item.inventoryNumber ? (
                    <p className="mt-1 break-all font-mono text-sm text-zinc-500">{item.inventoryNumber}</p>
                  ) : null}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${statusStyle(item.status)}`}>
                {translateValue(t, `status.${item.status}`)}
              </span>
            </div>

            <div className="mt-5 grid gap-2 rounded-2xl bg-zinc-50 p-4 text-sm">
              {location ? (
                <p className="flex items-center gap-2 text-zinc-700">
                  <MapPin className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
                  {location}
                </p>
              ) : null}
              <p className="flex items-center gap-2 font-medium text-zinc-900">
                <UserRound className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                {t("items.responsible")}: {item.responsibleName || t("tmc.qr.noResponsible")}
              </p>
            </div>

            <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-zinc-100 pt-5 text-sm sm:grid-cols-2">
              <Detail label={t("item.condition")} value={translateValue(t, `status.${item.status}`)} />
              <Detail label={t("items.type")} value={details ? dataLabel(details.itemType) : notSpecified} />
              <Detail label={t("itemDetails.brand")} value={details?.brand || notSpecified} />
              <Detail label={t("itemDetails.model")} value={details?.model || notSpecified} />
              <Detail label={t("items.quantity")} value={details ? String(details.quantity) : notSpecified} />
              <Detail label={t("itemDetails.unitPriceCurrency")} value={details ? new Intl.NumberFormat(locale).format(details.unitPrice) : notSpecified} />
              <Detail label={t("room.connected")} value={details ? translateValue(t, `connection.${details.connectionStatus}`) : notSpecified} />
              <Detail label={t("items.createdAt")} value={details ? formatDate(details.createdAt, locale, notSpecified) : notSpecified} />
            </dl>

            <div className="mt-5 border-t border-zinc-100 pt-5 text-sm">
              <p className="font-medium text-zinc-500">{t("itemDetails.description")}</p>
              <p className="mt-1 whitespace-pre-wrap leading-6 text-zinc-800">{details?.description || notSpecified}</p>
            </div>
          </div>
        </div>
        {actions ? (
          <div className="border-t border-zinc-100 bg-zinc-50/70 p-4 sm:p-5">{actions}</div>
        ) : null}
      </article>

      {photoOpen && details?.photoUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("itemDetails.photoFullSize")}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPhotoOpen(false);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
        >
          <button
            type="button"
            onClick={() => setPhotoOpen(false)}
            aria-label={t("common.close")}
            className="absolute right-4 top-4 z-10 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white text-zinc-900 shadow-lg"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
          <div className="relative h-full max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-black shadow-2xl">
            <Image
              src={details.photoUrl}
              alt={item.title}
              fill
              sizes="100vw"
              unoptimized
              className="object-contain"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 sm:block">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium text-zinc-900 sm:mt-1 sm:text-left">{value}</dd>
    </div>
  );
}

function translateValue(t: (key: TranslationKey) => string, key: string): string {
  return t(key as TranslationKey);
}

function formatDate(value: string, locale: string, fallback: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function statusStyle(status: ScannedItem["status"]): string {
  if (status === "active") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status === "maintenance") return "bg-amber-50 text-amber-900 ring-amber-200";
  if (status === "decommissioned") return "bg-red-50 text-red-800 ring-red-200";
  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}
