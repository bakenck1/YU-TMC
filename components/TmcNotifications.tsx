"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TmcNotificationFeedDto } from "@/lib/contracts/tmc-operations";
import type { TranslationKey } from "@/lib/i18n";

/** Maps static notification types to their translation keys. */
const NOTIFICATION_LABEL: Partial<Record<string, TranslationKey>> = {
  "tmc_transfer.overdue":   "tmc.notifications.overdue",
  "tmc_transfer.requested": "tmc.notifications.requested",
  "tmc_transfer.cancelled": "tmc.notifications.cancelled",
  "tmc_transfer.problem":   "tmc.notifications.problem",
};

/**
 * Derives the translation key for a completed notification based on the
 * safePayload. Admin decisions get their own label; otherwise accepted vs
 * rejected are differentiated so the recipient understands the outcome.
 */
function completedLabel(
  payload: Record<string, string | number | boolean | null>,
): TranslationKey {
  if (payload.isAdministrativeDecision) return "tmc.notifications.adminDecision";
  if (payload.status === "accepted") return "tmc.notifications.accepted";
  if (payload.status === "rejected") return "tmc.notifications.rejected";
  return "tmc.notifications.completed";
}

export default function TmcNotifications({ compact = false }: { compact?: boolean }) {
  const { t } = useAppSettings();
  const router = useRouter();
  const [feed, setFeed] = useState<TmcNotificationFeedDto | null>(null);
  const [open, setOpen] = useState(false);
  // useRef instead of useState so the guard is read synchronously inside the
  // click handler closure, preventing a double-navigation on rapid clicks.
  const openingIdRef = useRef<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = () => fetch("/api/inventory/notifications?limit=10", { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<TmcNotificationFeedDto> : Promise.reject())
        .then((value) => { if (active) setFeed(value); })
        .catch(() => { if (active) setFeed((current) => current ?? { notifications: [], unreadCount: 0 }); });
    const refreshOnFocus = () => { void load(); };
    void load();
    const interval = window.setInterval(() => { void load(); }, 15_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  async function openNotification(
    event: MouseEvent<HTMLAnchorElement>,
    notification: TmcNotificationFeedDto["notifications"][number],
  ) {
    event.preventDefault();
    if (openingIdRef.current) return;
    openingIdRef.current = notification.id;
    setOpeningId(notification.id);
    if (!notification.readAt) {
      try {
        const response = await fetch(`/api/inventory/notifications/${notification.id}/read`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.ok) {
          const readAt = new Date().toISOString();
          setFeed((current) => current ? {
            unreadCount: Math.max(0, current.unreadCount - 1),
            notifications: current.notifications.map((item) => item.id === notification.id ? { ...item, readAt } : item),
          } : current);
        }
      } catch {
        // Opening the request remains available even if the read receipt fails.
      }
    }
    setOpen(false);
    openingIdRef.current = null;
    setOpeningId(null);
    router.push(`/tmc/transfer-requests/${notification.requestId}`);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={compact ? t("tmc.notifications.title") : undefined} className={`relative inline-flex items-center gap-2 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 ${compact ? "min-h-11 min-w-11 justify-center" : "min-h-11 px-4"}`} aria-expanded={open}>
        <Bell className="h-5 w-5" /> {compact ? null : t("tmc.notifications.title")}
        {(feed?.unreadCount ?? 0) > 0 && <span className={`${compact ? "absolute -right-1 -top-1" : ""} inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white`} aria-label={t("tmc.notifications.unread")}>{feed!.unreadCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
          {feed?.notifications.length ? feed.notifications.map((notification) => (
            <Link key={notification.id} href={`/tmc/transfer-requests/${notification.requestId}`} onClick={(event) => void openNotification(event, notification)} aria-busy={openingId === notification.id} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-50 ${notification.readAt ? "text-zinc-500" : "font-semibold text-zinc-900"} ${openingId === notification.id ? "pointer-events-none opacity-60" : ""}`}>
              <span>{notification.type === "tmc_transfer.completed"
                ? t(completedLabel(notification.safePayload))
                : t(NOTIFICATION_LABEL[notification.type] ?? "tmc.notifications.completed")}</span>
              {notification.readAt
                ? <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-500">{t("tmc.notifications.read")}</span>
                : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />}
            </Link>
          )) : <p className="px-3 py-4 text-sm text-zinc-500">{t("tmc.notifications.empty")}</p>}
        </div>
      )}
    </div>
  );
}
