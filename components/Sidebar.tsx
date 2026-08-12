"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import IconButton from "@/components/IconButton";
import SidebarContent, { sidebarItemsForRole } from "@/components/SidebarContent";

export { sidebarItemsForRole };

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
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
        <SidebarContent collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} showCollapseToggle />
      </motion.aside>

      <AnimatePresence>
        {mobileOpen ? (
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
                <IconButton label="Закрыть навигацию" icon={X} onClick={onCloseMobile} />
              </div>
              <SidebarContent collapsed={false} onNavigate={onCloseMobile} showCollapseToggle={false} />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
