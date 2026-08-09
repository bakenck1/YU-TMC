"use client";

import { useAppSettings } from "@/components/AppSettingsProvider";
import { TMC_ENTRY_POINT } from "@/lib/tmc-navigation";

export default function TmcLanding() {
  const { t } = useAppSettings();

  return (
    <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold text-zinc-900 sm:text-2xl">
        {t(TMC_ENTRY_POINT.labelKey)}
      </h2>
    </section>
  );
}
