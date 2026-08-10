"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TmcNotificationFeedDto } from "@/lib/contracts/tmc-operations";

export default function TmcNotifications({ compact = false }: { compact?: boolean }) {
  const { t } = useAppSettings();
  const router = useRouter();
  const [feed, setFeed] = useState<TmcNotificationFeedDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/inventory/notifications?limit=10", { cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<TmcNotificationFeedDto> : Promise.reject())
        .then((value) => { if (active) setFeed(value); })
        .catch(() => { if (active) setFeed((current) => current ?? { notifications: [], unreadCount: 0 }); });
    const refreshOnFocus = () => { void load(); };
    void load();
    const interval = window.setInterval(() => { void load(); }, 15_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  async function openNotification(id: string, requestId: string) {
    const response = await fetch(`/api/inventory/notifications/${id}/read`, { method: "POST" });
    if (response.ok) {
      setFeed((current) => current ? {
        unreadCount: Math.max(0, current.unreadCount - (current.notifications.find((item) => item.id === id)?.readAt ? 0 : 1)),
        notifications: current.notifications.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item),
      } : current);
    }
    router.push(`/tmc/transfer-requests/${requestId}`);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={compact ? t("tmc.notifications.title") : undefined} className={`relative inline-flex items-center gap-2 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 ${compact ? "h-9 w-9 justify-center" : "min-h-11 px-4"}`} aria-expanded={open}>
        <Bell className="h-4 w-4" /> {compact ? null : t("tmc.notifications.title")}
        {(feed?.unreadCount ?? 0) > 0 && <span className="min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs text-white" aria-label={t("tmc.notifications.unread")}>{feed!.unreadCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
          {feed?.notifications.length ? feed.notifications.map((notification) => (
            <button key={notification.id} type="button" onClick={() => void openNotification(notification.id, notification.requestId)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-50 ${notification.readAt ? "text-zinc-500" : "font-semibold text-zinc-900"}`}>
              {notification.type === "tmc_transfer.completed" &&
              typeof notification.safePayload.accepted === "number" &&
              typeof notification.safePayload.itemCount === "number"
                ? t("tmc.request.result", { accepted: notification.safePayload.accepted, total: notification.safePayload.itemCount })
                : t(notification.type === "tmc_transfer.overdue" ? "tmc.notifications.overdue" : notification.type === "tmc_transfer.requested" ? "tmc.notifications.requested" : notification.type === "tmc_transfer.cancelled" ? "tmc.notifications.cancelled" : notification.type === "tmc_transfer.problem" ? "tmc.notifications.problem" : "tmc.notifications.completed")}
            </button>
          )) : <p className="px-3 py-4 text-sm text-zinc-500">{t("tmc.notifications.empty")}</p>}
        </div>
      )}
    </div>
  );
}
