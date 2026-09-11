"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { useAppSettings } from "@/components/AppSettingsProvider";

export default function InventoryItemBackLink({ href }: { href: string }) {
  const { t } = useAppSettings();
  const label = t("itemDetails.backToList");

  return (
    <Link
      href={href}
      replace
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:w-auto sm:px-3"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
