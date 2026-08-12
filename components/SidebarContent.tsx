"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  ScanLine,
  Settings,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import { useAuth } from "@/components/AuthProvider";
import SidebarNavLink from "@/components/SidebarNavLink";
import type { UserRole } from "@/lib/contracts/users";
import type { TranslationKey } from "@/lib/i18n";
import { canAccessPath } from "@/lib/security/authorization";

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", labelKey: "nav.home", icon: LayoutDashboard },
  { href: "/items", labelKey: "nav.items", icon: Boxes },
  { href: "/scan", labelKey: "nav.scanQr", icon: ScanLine },
  { href: "/requests", labelKey: "nav.requests", icon: ClipboardList },
  { href: "/tmc", labelKey: "tmc.entryPoint", icon: ArrowLeftRight },
  { href: "/items/decommissioned", labelKey: "nav.decommissioned", icon: Archive },
  { href: "/inventory", labelKey: "nav.objects", icon: Building2 },
  { href: "/inventory/inspections", labelKey: "nav.inspections", icon: ClipboardCheck },
  { href: "/analytics", labelKey: "nav.analytics", icon: BarChart3 },
  { href: "/users", labelKey: "nav.users", icon: Users },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
  { href: "/profile", labelKey: "nav.profile", icon: UserCircle },
];

const EMPLOYEE_NAV_PATHS = new Set(["/", "/items", "/scan", "/requests", "/tmc", "/profile"]);

export function sidebarItemsForRole(role: UserRole) {
  return NAV_ITEMS.filter(
    (item) =>
      (role !== "employee" || EMPLOYEE_NAV_PATHS.has(item.href)) &&
      canAccessPath(role, item.href),
  );
}

interface SidebarContentProps {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  showCollapseToggle: boolean;
}

export default function SidebarContent({
  collapsed,
  onToggleCollapsed,
  onNavigate,
  showCollapseToggle,
}: SidebarContentProps) {
  const pathname = usePathname();
  const { settings, t } = useAppSettings();
  const { user, loading: authLoading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const visibleItems = user ? sidebarItemsForRole(user.role) : [];
  const activeHref = visibleItems
    .filter((item) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutFailed(false);
    try {
      await logout();
      window.location.replace("/login");
    } catch {
      setLogoutFailed(true);
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
          <Image src="/logo.png" alt={settings.organizationName} width={36} height={36} className="h-full w-full object-contain p-1" priority />
        </div>
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden whitespace-nowrap font-[family-name:var(--font-montserrat)] text-sm font-semibold text-[#002060]"
            >
              {settings.organizationName}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {authLoading ? (
          <div className="space-y-2 px-1" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        ) : (
          visibleItems.map((item) => (
            <SidebarNavLink
              key={item.href}
              href={item.href}
              labelKey={item.labelKey}
              icon={item.icon}
              collapsed={collapsed}
              active={item.href === activeHref}
              onNavigate={onNavigate}
            />
          ))
        )}
      </nav>

      <div className="border-t border-black/5 px-3 py-3">
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          {loggingOut ? (
            <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-zinc-400" aria-hidden="true" />
          ) : (
            <LogOut className="h-5 w-5 shrink-0 text-zinc-400 group-hover:text-red-500" aria-hidden="true" />
          )}
          <AnimatePresence initial={false}>
            {!collapsed ? (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                {t("nav.logout")}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </button>
        {logoutFailed && !collapsed ? (
          <p className="px-3 pb-1 text-xs leading-5 text-red-600">{t("auth.logoutFailed")}</p>
        ) : null}
      </div>

      {showCollapseToggle && onToggleCollapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Развернуть навигацию" : "Свернуть навигацию"}
          className="absolute -right-3 top-16 flex h-6 w-6 items-center justify-center rounded-full border border-black/5 bg-white text-zinc-400 shadow-sm hover:text-accent-dark"
        >
          <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </motion.span>
        </button>
      ) : null}
    </div>
  );
}
