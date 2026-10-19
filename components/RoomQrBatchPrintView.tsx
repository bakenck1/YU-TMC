"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Download, Printer } from "lucide-react";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "@/components/AppSettingsProvider";
import styles from "./RoomQrBatchPrintView.module.css";

const LABELS_PER_SHEET = 12;

export default function RoomQrBatchPrintView({ rooms, buildings = [], qrImages }: { rooms: RoomDto[]; buildings?: BuildingDto[]; qrImages: Record<string, string> }) {
  const { t } = useAppSettings();
  const [loadedRoomIds, setLoadedRoomIds] = useState<Set<string>>(new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const readyToPrint = rooms.length > 0 && rooms.every((room) => loadedRoomIds.has(room.id));
  const sheets = Array.from({ length: Math.ceil(rooms.length / LABELS_PER_SHEET) }, (_, index) =>
    rooms.slice(index * LABELS_PER_SHEET, (index + 1) * LABELS_PER_SHEET));
  const buildingNames = new Map(buildings.map((building) => [building.id, building.name]));
  return (
    <main className={styles.root}>
      <header className={`${styles.toolbar} ${styles.screenOnly}`}>
        <div className={styles.toolbarContent}>
          <div>
            <h1 className="text-lg font-bold">{t("room.qrPrint")}</h1>
            <p className="text-sm text-zinc-600" role="status">{t("room.qrPrintSummary", { count: rooms.length, pages: sheets.length })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!readyToPrint || loadFailed} onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#002060] px-4 font-semibold text-white disabled:opacity-50"><Printer aria-hidden="true" className="h-5 w-5" />{t(readyToPrint ? "room.qrPrint" : "room.qrLoading")}</button>
            <Link href="/inventory" className="inline-flex min-h-11 items-center rounded-xl border border-zinc-200 px-4">{t("common.previous")}</Link>
          </div>
          {loadFailed ? <p role="alert" className="w-full text-sm text-red-700">{t("room.qrLoadError")}</p> : null}
        </div>
      </header>
      <div className={styles.content}>
        <p className={`${styles.help} ${styles.screenOnly}`}>{t("room.qrPrintHelp")}</p>
        {sheets.map((sheet, index) => (
          <section key={index} className={styles.sheet} aria-label={t("room.qrPrintSheet", { page: index + 1, pages: sheets.length })}>
            <p className={`${styles.sheetTitle} ${styles.screenOnly}`}>{t("room.qrPrintSheet", { page: index + 1, pages: sheets.length })}</p>
            {sheet.map((room) => (
              <div key={room.id} className={styles.label}>
                <div className={styles.labelDetails}>
                  <h2 className={styles.roomName}>{room.designation}</h2>
                  <p className={styles.buildingName}>{buildingNames.get(room.buildingId)}</p>
                </div>
                <Image src={qrImages[room.id]} alt={`QR ${room.designation}`} width={768} height={768} unoptimized loading="eager" onLoad={() => setLoadedRoomIds((current) => new Set(current).add(room.id))} onError={() => setLoadFailed(true)} className={styles.qr} />
                <a href={`/api/inventory/rooms/${room.id}/qr?download=1`} aria-label={`${t("room.qrDownload")}: ${room.designation}`} className={`${styles.screenOnly} mt-1 inline-flex min-h-11 items-center justify-center gap-2 text-sm text-[#002060]`}><Download aria-hidden="true" className="h-4 w-4" />{t("room.qrDownload")}</a>
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
