"use client";

import Link from "next/link";
import { Boxes, Building2, ClipboardList, Home, ScanLine, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { useAuth } from "@/components/AuthProvider";
import { canAccessPath } from "@/lib/security/authorization";

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
  const items = user?.role === "typography" ? TYPOGRAPHY_ITEMS : ITEMS;
  const visibleItems = items.filter(({ href }) => user && canAccessPath(user.role, href));
  return (
    <nav aria-label={t(user?.role === "typography" ? "nav.objects" : user?.role === "employee" ? "nav.items" : "nav.home")} className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
      <div className={`mx-auto grid h-[68px] max-w-xl px-1 ${user?.role === "typography" ? "grid-cols-2" : user?.role === "employee" ? "grid-cols-4" : "grid-cols-5"}`}>
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
