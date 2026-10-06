"use client";

import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { useAppSettings } from "./AppSettingsProvider";

export default function InventoryThumbnail({ photo }: { photo?: string }) {
  return <InventoryThumbnailImage key={photo ?? "none"} photo={photo} />;
}

export function InventoryThumbnailImage({ photo }: { photo?: string }) {
  const { t } = useAppSettings();
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-sky-200 bg-sky-50">
      {photo && !failed ? <Image src={photo} alt={t("items.photoAlt")} fill sizes="64px" unoptimized className="object-cover" onError={() => setFailed(true)} />
        : photo ? <button type="button" onClick={(event) => { event.stopPropagation(); setFailed(false); }} aria-label={`${t("items.photoAlt")}: ${t("error.retry")}`} title={t("error.retry")} className="flex h-full w-full items-center justify-center"><ImageIcon className="h-5 w-5 text-zinc-400" /></button>
        : <ImageIcon className="h-5 w-5 text-zinc-400" aria-label={t("items.photoMissing")} />}
      {photo ? <span className="pointer-events-none absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-bl-lg bg-emerald-500 px-1 text-[10px] font-semibold text-white">1</span> : null}
    </div>
  );
}
