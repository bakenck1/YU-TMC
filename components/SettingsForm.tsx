"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  Bell,
  Building2,
  CheckCircle2,
  Database,
  Languages,
  LoaderCircle,
  Mail,
  Save,
  Smartphone,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import type { AppLanguage, NotificationKey } from "@/lib/app-settings";

function SettingsToggle({
  settingKey,
  title,
  description,
  icon: Icon,
}: {
  settingKey: NotificationKey;
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  const { settings, notificationLoading, changeNotification, t } = useAppSettings();
  const checked = settings[settingKey];
  const loading = notificationLoading.includes(settingKey);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      disabled={loading}
      onClick={() => void changeNotification(settingKey, !checked)}
      className="group flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3 text-left outline-none transition hover:bg-zinc-50 active:bg-zinc-100 disabled:cursor-wait disabled:opacity-70 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 transition group-hover:bg-emerald-50 group-hover:text-emerald-700">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <span>
          <span className="block text-sm font-medium text-zinc-800">{title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-zinc-400">{description}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {loading && <LoaderCircle className="h-4 w-4 animate-spin text-emerald-600" aria-hidden="true" />}
        <span className="sr-only">{checked ? t("settings.switchOn") : t("settings.switchOff")}</span>
        <span
          aria-hidden="true"
          className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${
            checked ? "bg-emerald-600" : "bg-zinc-200"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              checked ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </span>
      </span>
    </button>
  );
}

export default function SettingsForm() {
  const {
    settings,
    language,
    organizationSaving,
    t,
    changeLanguage,
    saveOrganizationName,
  } = useAppSettings();
  const [organizationName, setOrganizationName] = useState(settings.organizationName);
  const [nameTouched, setNameTouched] = useState(false);

  const trimmedName = organizationName.trim();
  const validationError = useMemo(() => {
    if (!trimmedName) return t("settings.organizationRequired");
    if (trimmedName.length < 2) return t("settings.organizationTooShort");
    if (trimmedName.length > 80) return t("settings.organizationTooLong");
    return "";
  }, [t, trimmedName]);
  const organizationChanged = trimmedName !== settings.organizationName;
  const canSave = organizationChanged && !validationError && !organizationSaving;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameTouched(true);
    if (!canSave) return;
    const saved = await saveOrganizationName(trimmedName);
    if (saved) {
      setOrganizationName(trimmedName);
      setNameTouched(false);
    }
  }

  const languages: { value: AppLanguage; label: string }[] = [
    { value: "kk", label: t("settings.kazakh") },
    { value: "ru", label: t("settings.russian") },
    { value: "en", label: t("settings.english") },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900">{t("settings.title")}</h2>
        <p className="mt-1 text-sm text-zinc-400">{t("settings.subtitle")}</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
        <form onSubmit={submit} className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          <section className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold text-zinc-900">{t("settings.general")}</h3>
                <p className="mt-0.5 text-xs leading-5 text-zinc-400">{t("settings.generalHint")}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <label htmlFor="organization-name" className="text-sm font-medium text-zinc-700">
                {t("settings.organizationName")}
                <input
                  id="organization-name"
                  value={organizationName}
                  maxLength={81}
                  onBlur={() => setNameTouched(true)}
                  onChange={(event) => {
                    setOrganizationName(event.target.value);
                    if (nameTouched) setNameTouched(true);
                  }}
                  placeholder={t("settings.organizationPlaceholder")}
                  aria-invalid={nameTouched && Boolean(validationError)}
                  aria-describedby="organization-name-hint"
                  className={`mt-1.5 w-full rounded-xl border bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-800 outline-none transition focus:bg-white focus:ring-4 ${
                    nameTouched && validationError
                      ? "border-red-300 focus:border-red-400 focus:ring-red-500/10"
                      : "border-zinc-200 focus:border-emerald-400 focus:ring-emerald-500/10"
                  }`}
                />
                <span id="organization-name-hint" className={`mt-1.5 block text-xs ${nameTouched && validationError ? "text-red-500" : "text-zinc-400"}`}>
                  {nameTouched && validationError ? validationError : t("settings.organizationHint")}
                </span>
              </label>

              <label htmlFor="interface-language" className="text-sm font-medium text-zinc-700">
                {t("settings.interfaceLanguage")}
                <div className="relative mt-1.5">
                  <Languages className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <select
                    id="interface-language"
                    value={language}
                    onChange={(event) => void changeLanguage(event.target.value as AppLanguage)}
                    className="w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-9 text-sm text-zinc-800 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                  >
                    {languages.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="mt-1.5 block text-xs text-zinc-400">{t("settings.languageHint")}</span>
              </label>
            </div>
          </section>

          <section className="border-t border-zinc-100 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <Bell className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold text-zinc-900">{t("settings.notifications")}</h3>
                <p className="mt-0.5 text-xs leading-5 text-zinc-400">{t("settings.notificationsHint")}</p>
              </div>
            </div>

            <div className="mt-4 divide-y divide-zinc-100">
              <SettingsToggle
                settingKey="emailNotifications"
                title={t("settings.emailNotifications")}
                description={t("settings.emailNotificationsHint")}
                icon={Mail}
              />
              <SettingsToggle
                settingKey="pushNotifications"
                title={t("settings.pushNotifications")}
                description={t("settings.pushNotificationsHint")}
                icon={Smartphone}
              />
              <SettingsToggle
                settingKey="maintenanceAlerts"
                title={t("settings.maintenanceAlerts")}
                description={t("settings.maintenanceAlertsHint")}
                icon={Wrench}
              />
            </div>
          </section>

          <footer className="flex justify-end border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 sm:px-6">
            <button
              type="submit"
              disabled={!canSave}
              className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              {organizationSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {organizationSaving ? t("settings.saving") : t("settings.saveChanges")}
            </button>
          </footer>
        </form>

        <aside className="space-y-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-semibold text-zinc-900">{t("settings.profileTitle")}</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{t("settings.profileText")}</p>
            </div>
          </div>
          <div className="border-t border-zinc-100 pt-4">
            <div className="flex items-start gap-3 rounded-xl bg-zinc-50 p-3.5">
              <Database className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-zinc-800">{t("settings.serverStorage")}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{t("settings.serverStorageHint")}</p>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-3 rounded-xl bg-zinc-50 p-3.5">
              <Zap className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-medium text-zinc-800">{t("settings.realtime")}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{t("settings.realtimeHint")}</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
