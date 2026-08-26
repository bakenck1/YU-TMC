"use client";

import { useRef, useState, type FormEvent } from "react";
import Button from "./Button";
import SelectField from "./SelectField";
import SettingsToggleRow from "./SettingsToggleRow";
import TextField from "./TextField";
import { useAppSettings } from "./AppSettingsProvider";
import { isAppLanguage, type AppLanguage } from "@/lib/app-settings";
import type { TranslationKey } from "@/lib/i18n";

const LANGUAGE_OPTIONS = [
  { value: "ru", labelKey: "settings.russian" },
  { value: "kk", labelKey: "settings.kazakh" },
  { value: "en", labelKey: "settings.english" },
] as const;

export default function SettingsForm() {
  const {
    settings,
    language,
    t,
    notificationLoading,
    organizationSaving,
    changeLanguage,
    changeNotification,
    saveOrganizationName,
  } = useAppSettings();
  const [orgName, setOrgName] = useState(settings.organizationName);
  const [organizationError, setOrganizationError] = useState<TranslationKey | null>(null);
  const organizationEditVersion = useRef(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = orgName.trim();
    if (!trimmedName) {
      setOrganizationError("settings.organizationRequired");
      return;
    }
    if (trimmedName.length < 2) {
      setOrganizationError("settings.organizationTooShort");
      return;
    }
    if (trimmedName.length > 80) {
      setOrganizationError("settings.organizationTooLong");
      return;
    }
    setOrganizationError(null);
    const submittedEditVersion = organizationEditVersion.current;
    if (await saveOrganizationName(trimmedName) && submittedEditVersion === organizationEditVersion.current) {
      setOrgName(trimmedName);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="max-w-2xl space-y-6 rounded-2xl border border-black/5 bg-white p-6"
    >
      <TextField
        id="settings-organization-name"
        label={t("settings.organizationName")}
        value={orgName}
        onChange={(event) => {
          organizationEditVersion.current += 1;
          setOrganizationError(null);
          setOrgName(event.target.value);
        }}
        hint={t("settings.organizationHint")}
        variant="muted"
        maxLength={80}
        aria-invalid={organizationError ? "true" : undefined}
        aria-describedby={organizationError ? "settings-organization-error" : undefined}
      />
      {organizationError ? (
        <p id="settings-organization-error" role="alert" className="-mt-4 text-sm text-red-600">
          {t(organizationError)}
        </p>
      ) : null}

      <SelectField
        id="settings-language"
        label={t("settings.interfaceLanguage")}
        fieldSize="lg"
        value={language}
        onChange={(event) => {
          if (isAppLanguage(event.target.value)) {
            void changeLanguage(event.target.value as AppLanguage);
          }
        }}
        options={LANGUAGE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
      />

      <div className="space-y-4 border-t border-black/5 pt-4">
        <p className="text-sm font-medium text-zinc-700">{t("settings.notifications")}</p>

        <SettingsToggleRow
          label={t("settings.emailNotifications")}
          hint={t("settings.emailNotificationsHint")}
          checked={settings.emailNotifications}
          onChange={(checked) => void changeNotification("emailNotifications", checked)}
          disabled={notificationLoading.includes("emailNotifications")}
        />

        <SettingsToggleRow
          label={t("settings.pushNotifications")}
          hint={t("settings.pushNotificationsHint")}
          checked={settings.pushNotifications}
          onChange={(checked) => void changeNotification("pushNotifications", checked)}
          disabled={notificationLoading.includes("pushNotifications")}
        />

        <SettingsToggleRow
          label={t("settings.maintenanceAlerts")}
          hint={t("settings.maintenanceAlertsHint")}
          checked={settings.maintenanceAlerts}
          onChange={(checked) => void changeNotification("maintenanceAlerts", checked)}
          disabled={notificationLoading.includes("maintenanceAlerts")}
        />
      </div>

      <div className="border-t border-black/5 pt-4">
        <Button type="submit" variant="primary" loading={organizationSaving}>
          {organizationSaving ? t("settings.saving") : t("settings.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
