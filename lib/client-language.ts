import { isAppLanguage, isAppSettings, type AppLanguage } from "./app-settings";

const SETTINGS_STORAGE_KEY = "yu-inventory-settings-v1";
export const CLIENT_SETTINGS_CHANGE_EVENT = "yu-inventory-settings-change";

export function getClientLanguage(): AppLanguage {
  if (typeof window === "undefined") return "ru";

  try {
    const rawSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed: unknown = rawSettings ? JSON.parse(rawSettings) : null;
    if (isAppSettings(parsed)) return parsed.language;
  } catch {
    // Fall back to the document language when browser storage is unavailable.
  }

  if (typeof document !== "undefined" && isAppLanguage(document.documentElement.lang)) {
    return document.documentElement.lang;
  }
  return "ru";
}

export function getServerLanguage(): AppLanguage {
  return "ru";
}

export function subscribeToClientLanguage(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener(CLIENT_SETTINGS_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CLIENT_SETTINGS_CHANGE_EVENT, onChange);
  };
}
