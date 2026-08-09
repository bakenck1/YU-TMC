"use client";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TmcOperationNavigation } from "@/lib/tmc-navigation";

export default function TmcOperationShell({
  operation,
}: {
  operation: TmcOperationNavigation;
}) {
  const { t } = useAppSettings();

  return (
    <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold text-zinc-900 sm:text-2xl">
        {t(operation.labelKey)}
      </h2>
    </section>
  );
}
