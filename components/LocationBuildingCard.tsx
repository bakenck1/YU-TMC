"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, MapPin } from "lucide-react";
import type { Building } from "@/lib/types";
import { useAppSettings } from "./AppSettingsProvider";
import LocationFloorAccordion from "./LocationFloorAccordion";

export default function LocationBuildingCard({ building }: { building: Building }) {
  const [open, setOpen] = useState(false);
  const { t } = useAppSettings();
  return (
    <article className="rounded-2xl border border-black/5 bg-white p-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-4 text-left" aria-expanded={open}>
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-light text-accent-dark"><MapPin className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block truncate font-semibold text-zinc-800">{building.name}</span><span className="block truncate text-xs text-zinc-400">{building.address}</span></span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{building.itemCount} {t("common.unitShort")}</span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}><ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" /></motion.span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="mt-4 space-y-2">{building.floors.map((floor) => <LocationFloorAccordion key={floor.id} floor={floor} />)}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}
