import { Save } from "lucide-react";
import type { InventoryItem } from "@/lib/types";
import { splitInventoryLocation } from "@/lib/inventory-item-presentation";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";

export default function InventoryEditPanel({ item }: { item: InventoryItem }) {
  const location = splitInventoryLocation(item.location);
  const { t } = useAppSettings();
  const fields = [[t("items.type"), t("common.electronics")], [t("items.name"), item.itemType ?? item.name], [t("items.brandModelShort"), item.brandModel ?? item.name], [t("items.qrCode"), item.qrCode ?? item.inventoryNumber], [t("items.inventoryNumber"), item.inventoryNumber], [t("items.price"), (item.price ?? 0).toFixed(2)], [t("items.object"), location.object], [t("items.location"), location.room]];
  return <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">{t("items.editTitle")}</h2><p className="mt-1 text-sm text-zinc-500">{t("items.editSubtitle")}</p><div className="mt-6 grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <label key={label} className="rounded-xl bg-slate-100 px-4 py-3 text-xs text-zinc-400">{label}<input defaultValue={value} className="mt-1 block w-full bg-transparent text-sm text-zinc-800 outline-none" /></label>)}</div><div className="mt-6"><Button variant="primary" leadingIcon={Save}>{t("common.save")}</Button></div></section>;
}
