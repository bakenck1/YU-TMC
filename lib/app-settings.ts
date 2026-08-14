export type AppLanguage = "kk" | "ru" | "en";

export type NotificationKey =
  | "emailNotifications"
  | "pushNotifications"
  | "maintenanceAlerts";

export interface AppSettings {
  organizationName: string;
  language: AppLanguage;
  emailNotifications: boolean;
  pushNotifications: boolean;
  maintenanceAlerts: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  organizationName: "YU Inventory",
  language: "ru",
  emailNotifications: true,
  pushNotifications: false,
  maintenanceAlerts: true,
};

export const SUPPORTED_LANGUAGES: AppLanguage[] = ["ru", "kk", "en"];

const APP_SETTINGS_KEYS = [
  "organizationName",
  "language",
  "emailNotifications",
  "pushNotifications",
  "maintenanceAlerts",
] as const;

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && SUPPORTED_LANGUAGES.includes(value as AppLanguage);
}

export function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Partial<AppSettings>;
  const keys = Object.keys(settings);
  if (
    keys.length !== APP_SETTINGS_KEYS.length ||
    keys.some((key) => !APP_SETTINGS_KEYS.includes(key as (typeof APP_SETTINGS_KEYS)[number]))
  ) {
    return false;
  }
  return (
    typeof settings.organizationName === "string" &&
    isAppLanguage(settings.language) &&
    typeof settings.emailNotifications === "boolean" &&
    typeof settings.pushNotifications === "boolean" &&
    typeof settings.maintenanceAlerts === "boolean"
  );
}
