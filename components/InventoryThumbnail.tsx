import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";

export default function InventoryThumbnail({ photo }: { photo?: string }) {
  const { t } = useAppSettings();
  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-sky-200 bg-sky-50">
      {photo ? <Image src={photo} alt={t("items.photoAlt")} fill sizes="64px" unoptimized className="object-cover" /> : <ImageIcon className="h-5 w-5 text-zinc-400" aria-label={t("items.photoMissing")} />}
      <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-bl-lg bg-emerald-500 px-1 text-[10px] font-semibold text-white">1</span>
    </div>
  );
}
