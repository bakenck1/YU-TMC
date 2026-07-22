"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, DoorOpen, LayersIcon, MapPin } from "lucide-react";
import type { Building } from "@/lib/types";

function FloorAccordion({ floor }: { floor: Building["floors"][number] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-black/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <span className="flex items-center gap-2">
          <LayersIcon className="h-4 w-4 text-zinc-400" />
          {floor.name}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ul className="space-y-1 px-4 pb-3">
              {floor.rooms.map((room) => (
                <li
                  key={room.id}
                  className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
                >
                  <span className="flex items-center gap-2">
                    <DoorOpen className="h-4 w-4 text-zinc-400" />
                    {room.name}
                  </span>
                  <span className="rounded-full bg-accent-light px-2 py-0.5 text-xs font-medium text-accent-dark">
                    {room.itemCount} ед.
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BuildingCard({ building }: { building: Building }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-light text-accent-dark">
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-zinc-800">{building.name}</p>
            <p className="text-xs text-zinc-400">{building.address}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
            {building.itemCount} ед.
          </span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-2">
              {building.floors.map((floor) => (
                <FloorAccordion key={floor.id} floor={floor} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function LocationsTree({ buildings }: { buildings: Building[] }) {
  return (
    <div className="space-y-3">
      {buildings.map((building) => (
        <BuildingCard key={building.id} building={building} />
      ))}
    </div>
  );
}
