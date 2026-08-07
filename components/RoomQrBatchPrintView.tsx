"use client";

import Image from "next/image";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function RoomQrBatchPrintView({ rooms }: { rooms: RoomDto[] }) {
  const { t } = useAppSettings();
  return (
    <main className="min-h-screen bg-white p-4 sm:p-8 print:p-0">
      <div className="mx-auto mb-6 flex max-w-5xl flex-wrap gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#002060] px-4 font-semibold text-white"><Printer className="h-5 w-5" />{t("room.qrPrint")}</button>
        {rooms.map((room) => <a key={room.id} href={`/api/inventory/rooms/${room.id}/qr?download=1`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm"><Download className="h-4 w-4" />{room.designation}</a>)}
        <Link href="/inventory" className="inline-flex min-h-11 items-center rounded-xl border border-zinc-200 px-4">{t("common.previous")}</Link>
      </div>
      <section className="mx-auto grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-0">
        {rooms.map((room) => (
          <div key={room.id} className="flex aspect-square items-center justify-center break-inside-avoid p-2 print:p-1">
            <Image src={`/api/inventory/rooms/${room.id}/qr?format=svg`} alt={`QR ${room.designation}`} width={768} height={768} unoptimized className="h-full w-full object-contain" />
          </div>
        ))}
      </section>
    </main>
  );
}
