"use client";

import { useMemo } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import CampusItemStatusBadge from "@/components/CampusItemStatusBadge";
import { buildQrMatrix, QR_SIZE, type CampusHistoryTone, type CampusItem } from "@/lib/campus";

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
  const qr = useMemo(() => buildQrMatrix(item.id), [item.id]);

  return (
    <div className="animate-[campusFadeUp_.3s_ease] px-6 pb-10 pt-5">
      <div className="flex h-[200px] items-center justify-center rounded-2xl border border-[#e6ebe7] bg-[repeating-linear-gradient(135deg,#eef1ef,#eef1ef_12px,#e3e9e5_12px,#e3e9e5_24px)]">
        <span className="font-mono text-xs tracking-[.08em] text-[#8a948e]">{t("map.photo")}</span>
      </div>

      <div className="mt-5 flex items-start gap-3.5">
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-[.05em] text-[#002060]">{dataLabel(item.category)}</div>
          <div className="mt-1 text-[21px] font-extrabold leading-[1.2] tracking-[-.02em]">{item.name}</div>
          <div className="mt-1.5 text-[13px] font-semibold tabular-nums text-[#6b7671]">{t("map.invNo", { no: item.invNo })}</div>
        </div>
        <div className="shrink-0 text-center">
          <div className="h-24 w-24 rounded-xl border border-[#e6ebe7] bg-white p-[7px]">
            <div
              className="grid h-full w-full"
              style={{ gridTemplateColumns: `repeat(${QR_SIZE},1fr)`, gridTemplateRows: `repeat(${QR_SIZE},1fr)` }}
            >
              {qr.map((on, index) => (
                <div key={index} className={on ? "bg-[#12261c]" : "bg-transparent"} />
              ))}
            </div>
          </div>
          <div className="mt-1.5 text-[10px] font-semibold tracking-[.04em] text-[#98a29c]">{t("map.scan")}</div>
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
    </div>
  );
}
