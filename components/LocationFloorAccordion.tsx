"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, DoorOpen, LayersIcon } from "lucide-react";
import type { Building } from "@/lib/types";
import { useAppSettings } from "./AppSettingsProvider";

export default function LocationFloorAccordion({ floor }: { floor: Building["floors"][number] }) {
  const [open, setOpen] = useState(false);
  const { t } = useAppSettings();
  return (
    <div className="rounded-xl border border-black/5">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50" aria-expanded={open}>
        <span className="flex items-center gap-2"><LayersIcon className="h-4 w-4 text-zinc-400" aria-hidden="true" />{floor.name}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}><ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <ul className="space-y-1 px-4 pb-3">
              {floor.rooms.map((room) => (
                <li key={room.id} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
                  <span className="flex items-center gap-2"><DoorOpen className="h-4 w-4 text-zinc-400" aria-hidden="true" />{room.name}</span>
                  <span className="rounded-full bg-accent-light px-2 py-0.5 text-xs font-medium text-accent-dark">{room.itemCount} {t("common.unitShort")}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
