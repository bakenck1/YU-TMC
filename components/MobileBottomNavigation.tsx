"use client";

import { isEmployeeRole } from "@/lib/contracts/users";

import Link from "next/link";
import { Boxes, Building2, ClipboardList, Home, ScanLine, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { useAuth } from "@/components/AuthProvider";
import { canAccessPath } from "@/lib/security/authorization";
import { hasPermission } from "@/lib/security/permissions";

const ITEMS = [
  { href: "/", key: "nav.home" as const, icon: Home },
  { href: "/items", key: "nav.items" as const, icon: Boxes },
  { href: "/scan", key: "nav.scanQr" as const, icon: ScanLine, prominent: true },
  { href: "/requests", key: "nav.requests" as const, icon: ClipboardList },
  { href: "/profile", key: "nav.profile" as const, icon: UserRound },
];

const TYPOGRAPHY_ITEMS = [
  { href: "/inventory", key: "nav.objects" as const, icon: Building2, prominent: false },
  ITEMS[2],
];

export default function MobileBottomNavigation() {
  const pathname = usePathname();
  const { t } = useAppSettings();
  const { user } = useAuth();
  const passportItem = { href: "/room-passports", key: "passport.title" as const, icon: Building2, prominent: false };
  const items = user?.role === "typography" ? TYPOGRAPHY_ITEMS : user && hasPermission(user.role, "inventory.passport.manage") ? [...ITEMS.filter(item => item.href !== (isEmployeeRole(user.role) ? "/" : "/profile")), passportItem] : ITEMS;
  const visibleItems = items.filter(({ href }) => user && canAccessPath(user.role, href));
  return (
    <nav aria-label={t(user?.role === "typography" ? "nav.objects" : isEmployeeRole(user?.role) ? "nav.items" : "nav.home")} className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
      <div className="mx-auto grid h-[68px] max-w-xl px-1" style={{ gridTemplateColumns: `repeat(${visibleItems.length || 1}, minmax(0, 1fr))` }}>
        {visibleItems.map(({ href, key, icon: Icon, prominent }) => {
          const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium ${active ? "text-[#002060]" : "text-zinc-600"}`}>
              <span className={prominent ? "-mt-7 flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-emerald-500 text-white shadow-lg" : "flex h-6 items-center"}>
                <Icon className={prominent ? "h-7 w-7" : "h-5 w-5"} />
              </span>
              <span className={prominent ? "-mt-1" : ""}>{t(key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
