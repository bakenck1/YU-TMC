"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import type { TranslationKey } from "@/lib/i18n";

const SECTION_TITLES: Record<string, TranslationKey> = {
  "/": "nav.home",
  "/items": "nav.items",
  "/locations": "nav.locations",
  "/analytics": "nav.analytics",
  "/users": "nav.users",
  "/settings": "nav.settings",
};

export default function Header({ onOpenMobile }: { onOpenMobile: () => void }) {
  const pathname = usePathname();
  const { settings, t } = useAppSettings();
  const title = pathname.startsWith("/items/")
    ? `${t("nav.items")} / ${t("nav.itemCard")}`
    : SECTION_TITLES[pathname]
      ? t(SECTION_TITLES[pathname])
      : settings.organizationName;

  return (
    <header className="flex items-center justify-between border-b border-black/5 bg-white px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobile}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-zinc-800">{t("header.userName")}</p>
          <p className="text-xs text-zinc-400">{t("header.userRole")}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
          {t("header.userInitials")}
        </div>
      </div>
    </header>
  );
}
