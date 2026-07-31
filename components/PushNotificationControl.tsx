"use client";

import { Bell, BellOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppSettings } from "@/components/AppSettingsProvider";

import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  fetchPushConfiguration,
  supportsWebPush,
  syncExistingPushSubscription,
  type PushPublicConfiguration,
} from "@/lib/client-push-subscription";

type PushState =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "disabled"
  | "enabled"
  | "dismissed"
  | "denied"
  | "error";

export default function PushNotificationControl() {
  const { language, t } = useAppSettings();
  const [configuration, setConfiguration] =
    useState<PushPublicConfiguration | null>(null);
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void initialize().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
    };

    async function initialize() {
      if (!supportsWebPush()) {
        if (!cancelled) setState("unsupported");
        return;
      }
      const config = await fetchPushConfiguration();
      if (cancelled) return;
      setConfiguration(config);
      if (!config.configured || !config.publicKey) {
        setState("unconfigured");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const subscription = await currentPushSubscription();
      if (cancelled) return;
      if (subscription) {
        const synced = await syncExistingPushSubscription(config.publicKey, language);
        if (!synced) {
          setState("disabled");
          return;
        }
        if (!cancelled) setState("enabled");
      } else {
        setState("disabled");
      }
    }
  }, [language]);

  async function enable() {
    if (!configuration?.publicKey || busy) return;
    setBusy(true);
    try {
      await enablePushNotifications(configuration.publicKey, language);
      setState("enabled");
    } catch (error) {
      if (error instanceof Error && error.message === "push_permission_denied") {
        setState("denied");
      } else if (
        error instanceof Error &&
        error.message === "push_permission_dismissed"
      ) {
        setState("dismissed");
      } else {
        setState("error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    try {
      await disablePushNotifications();
      setState("disabled");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-zinc-500">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t("push.checking")}
      </div>
    );
  }

  if (state === "unsupported" || state === "unconfigured") {
    return (
      <p className="text-sm text-zinc-500">
        {t(state === "unsupported" ? "push.unsupported" : "push.unconfigured")}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void (state === "enabled" ? disable() : enable())}
        disabled={busy}
        className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${
          state === "enabled"
            ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border border-black/10 bg-white text-zinc-700"
        }`}
      >
        {busy ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : state === "enabled" ? (
          <Bell className="h-4 w-4" />
        ) : (
          <BellOff className="h-4 w-4" />
        )}
        {t(state === "enabled" ? "push.enabled" : "push.enable")}
      </button>
      {state === "denied" ? (
        <p role="status" className="text-sm text-amber-700">
          {t("push.denied")}
        </p>
      ) : state === "dismissed" ? (
        <p role="status" className="text-sm text-zinc-500">
          {t("push.dismissed")}
        </p>
      ) : state === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          {t("push.error")}
        </p>
      ) : (
        <p className="text-sm text-zinc-500">
          {t("push.assignmentHint")}
        </p>
      )}
    </div>
  );
}
