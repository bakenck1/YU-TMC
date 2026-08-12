import Image from "next/image";
import { QrCode } from "lucide-react";
import type { InventoryItem } from "@/lib/types";
import { splitInventoryLocation } from "@/lib/inventory-item-presentation";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";

export default function InventoryAssetCard({ item, canGenerateQr }: { item: InventoryItem; canGenerateQr: boolean }) {
  const location = splitInventoryLocation(item.location);
  const { t } = useAppSettings();
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-100 bg-[#fff8ec]">
      <div className="relative aspect-[4/3] w-full bg-zinc-100">{item.photo ? <Image src={item.photo} alt={item.name} fill priority sizes="(max-width: 768px) 100vw, 420px" className="object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-zinc-400">{t("items.photoMissing")}</div>}</div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-5 border-t border-amber-100 p-5">
        <dl className="space-y-3 text-sm"><div className="flex justify-between gap-4 border-b border-black/10 pb-3"><dt>{t("items.type")}</dt><dd className="text-zinc-600">{t("common.electronics")}</dd></div><div className="flex justify-between gap-4 border-b border-black/10 pb-3"><dt>{t("items.object")}</dt><dd className="text-zinc-600">{location.object}</dd></div><div className="flex justify-between gap-4 border-b border-black/10 pb-3"><dt>{t("items.location")}</dt><dd className="text-zinc-600">{location.room}</dd></div><div className="flex justify-between gap-4"><dt>{t("items.responsible")}</dt><dd className="text-right text-zinc-600">{item.responsible || t("common.notAssigned")}</dd></div></dl>
        <div className="hidden text-center sm:block"><QrCode className="mx-auto h-24 w-24 text-zinc-700" strokeWidth={1.5} aria-hidden="true" />{canGenerateQr ? <div className="mt-3"><Button variant="primary">{t("items.createQr")}</Button></div> : null}</div>
      </div>
    </section>
  );
}
