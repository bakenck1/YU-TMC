"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_APP_SETTINGS,
  isAppSettings,
  type AppLanguage,
  type AppSettings,
  type NotificationKey,
} from "@/lib/app-settings";
import {
  languageLocales,
  translate,
  translateDataLabel,
  type TranslationKey,
  type TranslationParams,
} from "@/lib/i18n";
import { syncPushSubscriptionLanguage } from "@/lib/client-push-subscription";

const STORAGE_KEY = "yu-inventory-settings-v1";

type PersistResult = "server" | "local" | "error";
type ToastType = "success" | "error" | "info";

interface ToastMessage {
  id: number;
  type: ToastType;
  title: TranslationKey;
  description?: TranslationKey;
}

interface AppSettingsContextValue {
  settings: AppSettings;
  language: AppLanguage;
  locale: string;
  notificationLoading: NotificationKey[];
  organizationSaving: boolean;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  dataLabel: (label: string) => string;
  changeLanguage: (language: AppLanguage) => Promise<void>;
  changeNotification: (key: NotificationKey, value: boolean) => Promise<void>;
  saveOrganizationName: (name: string) => Promise<boolean>;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function readLocalSettings() {
  try {
    const content = window.localStorage.getItem(STORAGE_KEY);
    if (!content) return null;
    const parsed: unknown = JSON.parse(content);
    return isAppSettings(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocalSettings(settings: AppSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function InitialLoading({
  language,
  authPage,
}: {
  language: AppLanguage;
  authPage: boolean;
}) {
  if (authPage) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        aria-busy="true"
        aria-label={translate(language, "common.loading")}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-base font-bold text-white">
            YU
          </div>
          <LoaderCircle className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen bg-background"
      aria-busy="true"
      aria-label={translate(language, "common.loading")}
    >
      <div className="hidden w-[248px] border-r border-black/5 bg-white p-4 md:block">
        <div className="h-9 w-32 animate-pulse rounded-xl bg-zinc-100" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-10 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-16 border-b border-black/5 bg-white" />
        <div className="flex flex-1 items-center justify-center">
          <LoaderCircle className="h-7 w-7 animate-spin text-emerald-600" />
        </div>
      </div>
    </div>
  );
}

export default function AppSettingsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const languageRef = useRef<AppLanguage>(DEFAULT_APP_SETTINGS.language);
  const [loading, setLoading] = useState(true);
  const [notificationLoading, setNotificationLoading] = useState<NotificationKey[]>([]);
  const [organizationSaving, setOrganizationSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) =>
      translate(settings.language, key, params),
    [settings.language],
  );

  const dataLabel = useCallback(
    (label: string) => translateDataLabel(settings.language, label),
    [settings.language],
  );

  const pushToast = useCallback((message: Omit<ToastMessage, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...message, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      const localSettings = readLocalSettings();

      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) throw new Error("settings_load_failed");
        const serverSettings: unknown = await response.json();
        if (!isAppSettings(serverSettings)) throw new Error("invalid_settings");
        if (!cancelled) {
          const mergedSettings = {
            ...serverSettings,
            language:
              localSettings?.language ?? DEFAULT_APP_SETTINGS.language,
          };
          languageRef.current = mergedSettings.language;
          setSettings(mergedSettings);
          saveLocalSettings(mergedSettings);
        }
      } catch {
        if (!cancelled) {
          const fallbackSettings = localSettings ?? DEFAULT_APP_SETTINGS;
          languageRef.current = fallbackSettings.language;
          setSettings(fallbackSettings);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  useEffect(() => {
    if (loading) return;
    void syncPushSubscriptionLanguage(settings.language).catch(() => undefined);
  }, [loading, settings.language]);

  const persistPatch = useCallback(
    async (patch: Partial<AppSettings>, optimisticSettings: AppSettings): Promise<PersistResult> => {
      try {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!response.ok) throw new Error("settings_save_failed");
        const serverSettings: unknown = await response.json();
        if (!isAppSettings(serverSettings)) throw new Error("invalid_settings");
        const mergedSettings = {
          ...serverSettings,
          language: languageRef.current,
        };
        setSettings(mergedSettings);
        saveLocalSettings(mergedSettings);
        return "server";
      } catch {
        const mergedSettings = {
          ...optimisticSettings,
          language: languageRef.current,
        };
        if (saveLocalSettings(mergedSettings)) {
          setSettings(mergedSettings);
          return "local";
        }
        return "error";
      }
    },
    [],
  );

  const changeLanguage = useCallback(
    async (language: AppLanguage) => {
      if (language === settings.language) return;
      const previous = settings;
      const optimistic = { ...settings, language };
      languageRef.current = language;
      setSettings(optimistic);
      if (!saveLocalSettings(optimistic)) {
        languageRef.current = previous.language;
        setSettings(previous);
        pushToast({
          type: "error",
          title: "settings.saveFailed",
          description: "settings.connectionError",
        });
        return;
      }
      pushToast({
        type: "success",
        title: "settings.languageChanged",
      });
    },
    [pushToast, settings],
  );

  const changeNotification = useCallback(
    async (key: NotificationKey, value: boolean) => {
      if (notificationLoading.includes(key)) return;
      const previous = settings;
      const optimistic = { ...settings, [key]: value };
      setSettings(optimistic);
      setNotificationLoading((current) => [...current, key]);
      const result = await persistPatch({ [key]: value }, optimistic);
      setNotificationLoading((current) => current.filter((item) => item !== key));

      if (result === "error") {
        setSettings((current) => ({ ...current, [key]: previous[key] }));
        pushToast({
          type: "error",
          title: "settings.saveFailed",
          description: "settings.connectionError",
        });
        return;
      }

      pushToast({
        type: result === "local" ? "info" : "success",
        title: result === "local" ? "settings.savedLocally" : "settings.notificationsSaved",
      });
    },
    [notificationLoading, persistPatch, pushToast, settings],
  );

  const saveOrganizationName = useCallback(
    async (name: string) => {
      if (organizationSaving) return false;
      const trimmedName = name.trim();
      const optimistic = { ...settings, organizationName: trimmedName };
      setOrganizationSaving(true);
      const result = await persistPatch({ organizationName: trimmedName }, optimistic);
      setOrganizationSaving(false);

      if (result === "error") {
        pushToast({
          type: "error",
          title: "settings.saveFailed",
          description: "settings.connectionError",
        });
        return false;
      }

      pushToast({
        type: result === "local" ? "info" : "success",
        title: result === "local" ? "settings.savedLocally" : "settings.changesSaved",
      });
      return true;
    },
    [organizationSaving, persistPatch, pushToast, settings],
  );

  const contextValue = useMemo<AppSettingsContextValue>(
    () => ({
      settings,
      language: settings.language,
      locale: languageLocales[settings.language],
      notificationLoading,
      organizationSaving,
      t,
      dataLabel,
      changeLanguage,
      changeNotification,
      saveOrganizationName,
    }),
    [
      changeLanguage,
      changeNotification,
      dataLabel,
      notificationLoading,
      organizationSaving,
      saveOrganizationName,
      settings,
      t,
    ],
  );

  if (loading) {
    return (
      <InitialLoading
        language={settings.language}
        authPage={[
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
        ].includes(pathname)}
      />
    );
  }

  return (
    <AppSettingsContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-xl ${
              toast.type === "error"
                ? "border-red-200"
                : toast.type === "info"
                  ? "border-sky-200"
                  : "border-emerald-200"
            }`}
          >
            {toast.type === "error" ? (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            ) : (
              <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${toast.type === "info" ? "text-sky-500" : "text-emerald-500"}`} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-800">{t(toast.title)}</p>
              {toast.description && <p className="mt-1 text-xs text-zinc-500">{t(toast.description)}</p>}
            </div>
            <button
              type="button"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return context;
}
