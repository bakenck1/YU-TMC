"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Languages,
  MapPin,
  Monitor,
  PackageCheck,
  Printer,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { AppLanguage } from "@/lib/app-settings";
import type { TranslationKey } from "@/lib/i18n";

const LANGUAGE_OPTIONS: Array<{
  value: AppLanguage;
  short: string;
  labelKey: "settings.kazakh" | "settings.russian" | "settings.english";
}> = [
  { value: "ru", short: "РУС", labelKey: "settings.russian" },
  { value: "kk", short: "ҚАЗ", labelKey: "settings.kazakh" },
  { value: "en", short: "ENG", labelKey: "settings.english" },
];

const AUTH_PAGE_TITLE_KEYS: Record<string, TranslationKey> = {
  "/login": "auth.loginTitle",
  "/register": "auth.registerTitle",
  "/forgot-password": "auth.forgotTitle",
  "/reset-password": "auth.resetTitle",
};

export default function AuthPageFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { settings, language, changeLanguage, t } = useAppSettings();

  useEffect(() => {
    const titleKey = AUTH_PAGE_TITLE_KEYS[pathname];
    if (titleKey) document.title = `${t(titleKey)} | YU Inventory`;
  }, [pathname, t]);

  return (
    <main className="min-h-screen bg-[#f3f7f4] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1240px] overflow-hidden rounded-[30px] border border-black/5 bg-white shadow-[0_24px_70px_rgba(24,63,41,0.10)] lg:grid-cols-[minmax(420px,0.88fr)_minmax(520px,1.12fr)]">
        <section className="flex min-h-[680px] flex-col px-6 py-6 sm:px-10 sm:py-8 lg:px-14 lg:py-10">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-sm font-bold text-white shadow-sm">
                YU
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {settings.organizationName}
                </p>
                <p className="text-xs text-zinc-400">{t("auth.inventoryLabel")}</p>
              </div>
            </div>

            <label className="relative flex w-full items-center sm:w-auto sm:shrink-0">
              <span className="sr-only">{t("auth.language")}</span>
              <Languages className="pointer-events-none absolute left-3 h-4 w-4 text-zinc-400" />
              <select
                value={language}
                onChange={(event) =>
                  void changeLanguage(event.target.value as AppLanguage)
                }
                className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white pl-9 pr-8 text-xs font-semibold text-zinc-700 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 sm:w-auto"
                aria-label={t("auth.language")}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.short} · {t(option.labelKey)}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 text-[10px] text-zinc-400">
                ▾
              </span>
            </label>
          </div>

          <div className="flex flex-1 items-center py-12">
            <div className="mx-auto w-full max-w-[430px]">{children}</div>
          </div>

          <p className="text-center text-xs leading-5 text-zinc-400">
            © {new Date().getFullYear()} {settings.organizationName}
          </p>
        </section>

        <aside className="relative hidden min-h-[680px] overflow-hidden bg-[#123c27] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div
            className="absolute -right-20 -top-20 h-64 w-64 rounded-full border-[42px] border-emerald-400/10"
            aria-hidden="true"
          />
          <div
            className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full border-[48px] border-white/5"
            aria-hidden="true"
          />

          <div className="relative z-10 max-w-lg">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
              <PackageCheck className="h-6 w-6" />
            </div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight xl:text-4xl">
              {t("auth.visualTitle")}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-emerald-50/70">
              {t("auth.visualSubtitle")}
            </p>
          </div>

          <div className="relative z-10 my-10 flex min-h-[285px] items-center justify-center">
            <div className="relative h-[270px] w-full max-w-[500px]">
              <div className="absolute left-1/2 top-1/2 flex h-44 w-60 -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-300 text-[#123c27]">
                    <Monitor className="h-5 w-5" />
                  </div>
                  <span className="rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-medium text-emerald-200">
                    {t("auth.online")}
                  </span>
                </div>
                <div className="mt-auto grid grid-cols-3 gap-2">
                  {[48, 72, 58].map((height, index) => (
                    <div
                      key={index}
                      className="flex h-16 items-end rounded-lg bg-black/10 p-1.5"
                    >
                      <div
                        className="w-full rounded-md bg-emerald-300/80"
                        style={{ height: `${height}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="absolute left-2 top-5 flex w-40 items-center gap-3 rounded-2xl border border-white/10 bg-[#1b4a32] p-3 shadow-lg">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-300/15 text-sky-200">
                  <Printer className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-semibold">110</p>
                  <p className="text-[11px] text-white/55">{t("auth.assets")}</p>
                </div>
              </div>

              <div className="absolute right-1 top-12 flex w-40 items-center gap-3 rounded-2xl border border-white/10 bg-[#1b4a32] p-3 shadow-lg">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-300/15 text-amber-200">
                  <MapPin className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-semibold">24</p>
                  <p className="text-[11px] text-white/55">
                    {t("auth.locations")}
                  </p>
                </div>
              </div>

              <div className="absolute bottom-1 left-10 flex w-44 items-center gap-3 rounded-2xl border border-white/10 bg-[#1b4a32] p-3 shadow-lg">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-300/15 text-violet-200">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-semibold">18</p>
                  <p className="text-[11px] text-white/55">
                    {t("auth.responsibles")}
                  </p>
                </div>
              </div>

              <div className="absolute bottom-5 right-6 flex items-center gap-2 rounded-2xl border border-white/10 bg-[#1b4a32] p-3 shadow-lg">
                <Server className="h-5 w-5 text-emerald-200" />
                <Boxes className="h-5 w-5 text-emerald-300" />
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-3 border-t border-white/10 pt-6 text-sm text-emerald-50/75">
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" />
            <span>{t("auth.historyProtected")}</span>
          </div>
        </aside>
      </div>
    </main>
  );
}
