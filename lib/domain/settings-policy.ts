import {
  isAppLanguage,
  type AppSettings,
} from "@/lib/app-settings";
import { validationError } from "@/lib/domain/application-error";

export type AppSettingsPatch = Partial<AppSettings>;

const SETTINGS_KEYS = new Set<keyof AppSettings>([
  "organizationName",
  "language",
  "emailNotifications",
  "pushNotifications",
  "maintenanceAlerts",
]);

const NOTIFICATION_KEYS = [
  "emailNotifications",
  "pushNotifications",
  "maintenanceAlerts",
] as const;

export function parseAppSettingsPatch(input: unknown): AppSettingsPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw validationError("invalid_settings_payload");
  }

  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !SETTINGS_KEYS.has(key as keyof AppSettings))) {
    throw validationError("invalid_settings_payload");
  }

  const patch: AppSettingsPatch = {};

  if (Object.hasOwn(record, "organizationName")) {
    if (typeof record.organizationName !== "string") {
      throw validationError("invalid_organization_name");
    }

    const organizationName = record.organizationName.trim();
    if (organizationName.length < 2 || organizationName.length > 80) {
      throw validationError("invalid_organization_name");
    }
    patch.organizationName = organizationName;
  }

  if (Object.hasOwn(record, "language")) {
    if (!isAppLanguage(record.language)) {
      throw validationError("invalid_language");
    }
    patch.language = record.language;
  }

  for (const key of NOTIFICATION_KEYS) {
    if (!Object.hasOwn(record, key)) continue;
    if (typeof record[key] !== "boolean") {
      throw validationError("invalid_notification_setting");
    }
    patch[key] = record[key];
  }

  return patch;
}
