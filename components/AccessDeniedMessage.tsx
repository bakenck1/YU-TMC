"use client";

import Link from "next/link";
import { ShieldX } from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function AccessDeniedMessage() {
  const { t } = useAppSettings();
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
      <ShieldX className="mx-auto h-12 w-12 text-amber-700" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-bold text-zinc-900">{t("accessDenied.title")}</h1>
      <p className="mt-2 text-zinc-600">{t("accessDenied.description")}</p>
      <Link href="/" className="mt-6 inline-flex rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white">
        {t("nav.home")}
      </Link>
    </section>
  );
}
