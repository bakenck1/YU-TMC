"use client";

import { usePathname } from "next/navigation";
import { Languages, Menu } from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import { useAuth } from "./AuthProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { AuthRole } from "@/lib/security/authorization";
import type { AppLanguage } from "@/lib/app-settings";

const SECTION_TITLES: Record<string, TranslationKey> = {
  "/": "nav.home",
  "/items": "nav.items",
  "/inventory": "nav.objects",
  "/inventory/inspections": "nav.inspections",
  "/locations": "nav.locations",
  "/analytics": "nav.analytics",
  "/users": "nav.users",
  "/settings": "nav.settings",
};

const ROLE_LABELS: Record<AuthRole, TranslationKey> = {
  admin: "auth.roleAdmin",
  warehouse: "auth.roleWarehouse",
  employee: "auth.roleEmployee",
};

function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const value =
    parts.length > 1
      ? `${parts[0][0]}${parts[1][0]}`
      : parts[0]?.slice(0, 2) || email.slice(0, 2);
  return value.toLocaleUpperCase();
}

export default function Header({ onOpenMobile }: { onOpenMobile: () => void }) {
  const pathname = usePathname();
  const { settings, language, changeLanguage, t } = useAppSettings();
  const { user, loading } = useAuth();
  const title = pathname === "/items/decommissioned"
    ? t("nav.decommissioned")
    : pathname.startsWith("/items/")
      ? `${t("nav.items")} / ${t("nav.itemCard")}`
    : pathname.startsWith("/inventory/inspections")
      ? t("nav.inspections")
      : pathname.startsWith("/inventory/")
        ? t("nav.objects")
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
        <label className="relative flex items-center">
          <span className="sr-only">{t("auth.language")}</span>
          <Languages className="pointer-events-none absolute left-2.5 h-4 w-4 text-zinc-400" />
          <select
            value={language}
            onChange={(event) =>
              void changeLanguage(event.target.value as AppLanguage)
            }
            aria-label={t("auth.language")}
            className="h-9 appearance-none rounded-lg border border-zinc-200 bg-white pl-8 pr-7 text-xs font-semibold uppercase text-zinc-600 outline-none focus:border-emerald-500"
          >
            <option value="ru">RU</option>
            <option value="kk">KK</option>
            <option value="en">EN</option>
          </select>
        </label>
        <div className="hidden text-right sm:block">
          <p className="max-w-56 truncate text-sm font-medium text-zinc-800">
            {loading ? "…" : user?.name ?? "—"}
          </p>
          <p className="text-xs text-zinc-400">
            {user ? t(ROLE_LABELS[user.role]) : "—"}
          </p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
          {user ? initials(user.name, user.email) : "YU"}
        </div>
      </div>
    </header>
  );
}
