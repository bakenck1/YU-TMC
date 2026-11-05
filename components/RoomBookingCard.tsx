"use client";

import { ArrowUpRight, CalendarDays } from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { RoomBookingDto } from "@/lib/contracts/room-booking";

export default function RoomBookingCard({ booking }: { booking: RoomBookingDto }) {
  const { t } = useAppSettings();
  if (booking.status === "hidden") return null;
  const available = booking.status === "available";

  return (
    <section aria-label={t("room.bookingTitle")} className="rounded-3xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#002060]">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-900">{t("room.bookingTitle")}</h2>
              {!available ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">{t("room.bookingSoon")}</span> : null}
            </div>
            <p id="room-booking-description" className="mt-1 text-sm leading-6 text-zinc-600">
              {t(available ? "room.bookingDescription" : "room.bookingSoonDescription")}
            </p>
          </div>
        </div>
        {available ? (
          <a href={booking.href} rel="noreferrer" className="inline-flex min-h-12 w-full shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl bg-[#002060] px-5 py-3 text-center text-sm font-semibold text-white hover:bg-[#003078] active:bg-[#001744] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 lg:w-auto">
            {t("room.bookingAction")}<ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <button type="button" disabled aria-describedby="room-booking-description" className="inline-flex min-h-12 w-full shrink-0 items-center justify-center rounded-xl bg-zinc-100 px-5 py-3 text-center text-sm font-semibold text-zinc-500 lg:w-auto">
            {t("room.bookingAction")}
          </button>
        )}
      </div>
    </section>
  );
}
