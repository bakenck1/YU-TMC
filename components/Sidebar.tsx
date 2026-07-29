"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Boxes,
  ChevronLeft,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  LoaderCircle,
  MapPin,
  ScanLine,
  Settings,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";
import { useAuth } from "./AuthProvider";
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
  { href: "/inventory", labelKey: "nav.inventory", icon: ScanLine },
  {
    href: "/inventory/inspections",
    labelKey: "nav.inspections",
    icon: ClipboardCheck,
  },
  { href: "/locations", labelKey: "nav.locations", icon: MapPin },
  { href: "/analytics", labelKey: "nav.analytics", icon: BarChart3 },
  { href: "/users", labelKey: "nav.users", icon: Users },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function NavLink({
  item,
  collapsed,
  active,
  onClick,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onClick?: () => void;
}) {
  const { t } = useAppSettings();
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-accent-light hover:text-accent-dark"
    >
      {active ? (
        <motion.span
          layoutId="active-nav-indicator"
          className="absolute left-0 top-1 bottom-1 w-1 rounded-full bg-accent"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      ) : null}
      <motion.span
        className="flex h-5 w-5 shrink-0 items-center justify-center"
        whileHover={{ scale: 1.08 }}
      >
        <Icon
          className={`h-5 w-5 ${active ? "text-accent-dark" : "text-zinc-500 group-hover:text-accent-dark"}`}
        />
      </motion.span>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15 }}
            className={`overflow-hidden whitespace-nowrap ${active ? "text-accent-dark" : ""}`}
          >
            {t(item.labelKey)}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

function SidebarContent({
  collapsed,
  onToggleCollapsed,
  onNavigate,
  showCollapseToggle,
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  showCollapseToggle: boolean;
}) {
  const pathname = usePathname();
  const { settings, t } = useAppSettings();
  const { user, loading: authLoading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const visibleItems = user
    ? NAV_ITEMS.filter((item) => canAccessPath(user.role, item.href))
    : [];

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
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
              style={{ fontFamily: "var(--font-montserrat)" }}
              className="overflow-hidden whitespace-nowrap text-sm font-semibold text-[#002060]"
            >
              {settings.organizationName}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {authLoading ? (
          <div className="space-y-2 px-1" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-10 animate-pulse rounded-xl bg-zinc-100"
              />
            ))}
          </div>
        ) : (
          visibleItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              active={
                item.href === "/"
                  ? pathname === "/"
                  : item.href === "/inventory"
                    ? pathname === "/inventory"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`)
              }
              onClick={onNavigate}
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
            <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-zinc-400" />
          ) : (
            <LogOut className="h-5 w-5 shrink-0 text-zinc-400 group-hover:text-red-500" />
          )}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                {t("nav.logout")}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        {logoutFailed && !collapsed ? (
          <p className="px-3 pb-1 text-xs leading-5 text-red-600">
            {t("auth.logoutFailed")}
          </p>
        ) : null}
      </div>

      {showCollapseToggle && onToggleCollapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="absolute -right-3 top-16 flex h-6 w-6 items-center justify-center rounded-full border border-black/5 bg-white text-zinc-400 shadow-sm hover:text-accent-dark"
        >
          <motion.span
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </motion.span>
        </button>
      ) : null}
    </div>
  );
}

export default function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      <motion.aside
        animate={{ width: collapsed ? 76 : 248 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="relative hidden shrink-0 border-r border-black/5 md:block"
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          showCollapseToggle
        />
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onCloseMobile}
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
            />
            <motion.div
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 w-64 shadow-xl md:hidden"
            >
              <div className="flex justify-end px-3 pt-3">
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SidebarContent
                collapsed={false}
                onNavigate={onCloseMobile}
                showCollapseToggle={false}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
