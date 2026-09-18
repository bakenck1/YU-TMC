"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import CampusItemStatusBadge from "@/components/CampusItemStatusBadge";
import { type CampusHistoryTone, type CampusItem } from "@/lib/campus";
import {
  code39PayloadForInventoryNumber,
  renderCode39Svg,
} from "@/lib/domain/code39";

interface CampusItemCardProps {
  item: CampusItem;
  buildingName: string;
}

const HISTORY_TONES: Record<CampusHistoryTone, string> = {
  neutral: "bg-[#9aa8a0]",
  info: "bg-[#2f74c9]",
  danger: "bg-[#b0483a]",
  warning: "bg-[#c98a2b]",
  success: "bg-[#1a8a52]",
};

export default function CampusItemCard({ item, buildingName }: CampusItemCardProps) {
  const { dataLabel, t } = useAppSettings();
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const barcode = useMemo(() => {
    const payload = code39PayloadForInventoryNumber(item.invNo);
    return payload ? { payload, svg: renderCode39Svg(payload) } : null;
  }, [item.invNo]);
  const hasPhoto = Boolean(item.photoUrl) && !photoFailed;

  return (
    <div className="animate-[campusFadeUp_.3s_ease] px-6 pb-10 pt-5">
      {hasPhoto ? (
        <button
          type="button"
          onClick={() => setPhotoOpen(true)}
          aria-label={t("map.openPhoto")}
          className="relative block h-[200px] w-full overflow-hidden rounded-2xl border border-[#e6ebe7] bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002060]"
        >
          <Image
            src={item.photoUrl!}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 90vw, 570px"
            unoptimized
            className="object-cover"
            onError={() => setPhotoFailed(true)}
          />
        </button>
      ) : (
        <div className="flex h-[200px] items-center justify-center rounded-2xl border border-[#e6ebe7] bg-[repeating-linear-gradient(135deg,#eef1ef,#eef1ef_12px,#e3e9e5_12px,#e3e9e5_24px)]">
          <span className="font-mono text-xs tracking-[.08em] text-[#8a948e]">{t("items.photoMissing")}</span>
        </div>
      )}

      <div className="mt-5 flex items-start gap-3.5">
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-[.05em] text-[#002060]">{dataLabel(item.category)}</div>
          <div className="mt-1 text-[21px] font-extrabold leading-[1.2] tracking-[-.02em]">{item.name}</div>
          <div className="mt-1.5 text-[13px] font-semibold tabular-nums text-[#6b7671]">{t("map.invNo", { no: item.invNo })}</div>
        </div>
        <div className="w-48 shrink-0 text-center">
          {barcode ? (
            <>
              <div
                data-testid="campus-item-code39"
                className="overflow-hidden rounded-xl border border-[#e6ebe7] bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: barcode.svg }}
              />
              <div className="mt-1.5 break-all font-mono text-[10px] font-semibold tracking-[.04em] text-[#6b7671]">{item.invNo}</div>
            </>
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{t("map.barcodeMissing")}</p>
          )}
        </div>
      </div>

      <CampusItemStatusBadge status={item.status} variant="card" />

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-[13px] border border-[#eaefec] bg-white p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-[.03em] text-[#8a948e]">{t("map.location")}</div>
          <div className="mt-1 text-sm font-bold">{buildingName}, {t("map.roomShort")} {item.code}</div>
        </div>
        <div className="rounded-[13px] border border-[#eaefec] bg-white p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-[.03em] text-[#8a948e]">{t("map.responsible")}</div>
          <div className="mt-1 text-sm font-bold">{dataLabel(item.responsible)}</div>
        </div>
      </div>

      <div className="mb-1 mt-6 text-[13px] font-extrabold text-[#3c463f]">{t("map.history")}</div>
      <div className="relative mt-3.5 pl-1.5">
        {item.history.map((historyEntry, index) => (
          <div key={index} className="relative ml-1.5 border-l-2 border-[#e7ece8] pb-5 pl-6">
            <span className={`absolute -left-[7px] top-px h-3 w-3 rounded-full border-2 border-[#fbfcfb] ${HISTORY_TONES[historyEntry.tone]}`} />
            <div className="text-[13.5px] font-bold">{historyEntry.action}</div>
            <div className="mt-0.5 text-xs leading-6 text-[#6b7671]">{historyEntry.detail}</div>
            <div className="mt-0.5 text-[11.5px] tabular-nums text-[#98a29c]">{historyEntry.date} · {historyEntry.who}</div>
          </div>
        ))}
      </div>

      {photoOpen && hasPhoto ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("map.openPhoto")}
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPhotoOpen(false)}
        >
          <button type="button" className="absolute right-4 top-4 min-h-11 rounded-xl bg-white px-4 font-semibold text-zinc-900" onClick={() => setPhotoOpen(false)}>{t("common.close")}</button>
          <div className="relative h-[85vh] w-[92vw]" onClick={(event) => event.stopPropagation()}>
            <Image src={item.photoUrl!} alt={item.name} fill sizes="92vw" unoptimized className="object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
