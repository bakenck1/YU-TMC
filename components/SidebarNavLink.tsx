"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TranslationKey } from "@/lib/i18n";

interface SidebarNavLinkProps {
  href: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  collapsed: boolean;
  active: boolean;
  onNavigate?: () => void;
}

export default function SidebarNavLink({
  href,
  labelKey,
  icon: Icon,
  collapsed,
  active,
  onNavigate,
}: SidebarNavLinkProps) {
  const { t } = useAppSettings();

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-accent-light hover:text-accent-dark"
    >
      {active ? (
        <motion.span
          layoutId="active-nav-indicator"
          className="absolute bottom-1 left-0 top-1 w-1 rounded-full bg-accent"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      ) : null}
      <motion.span className="flex h-5 w-5 shrink-0 items-center justify-center" whileHover={{ scale: 1.08 }}>
        <Icon
          className={`h-5 w-5 ${active ? "text-accent-dark" : "text-zinc-500 group-hover:text-accent-dark"}`}
          aria-hidden="true"
        />
      </motion.span>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15 }}
            className={`overflow-hidden whitespace-nowrap ${active ? "text-accent-dark" : ""}`}
          >
            {t(labelKey)}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </Link>
  );
}
