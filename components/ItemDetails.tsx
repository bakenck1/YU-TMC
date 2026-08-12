"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckSquare,
  Edit3,
  Info,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { InventoryItem } from "@/lib/types";
import {
  legacyItemDetailVisibility,
  type LegacyItemDetailTab,
} from "@/lib/item-detail-visibility";
import { useAppSettings } from "./AppSettingsProvider";
import type { TranslationKey } from "@/lib/i18n";
import InventoryActionPanel from "./InventoryActionPanel";
import InventoryAssetCard from "./InventoryAssetCard";
import InventoryEditPanel from "./InventoryEditPanel";
import InventoryInformationPanel from "./InventoryInformationPanel";
import LegacyDisplayStatusBadge from "./LegacyDisplayStatusBadge";

type DetailTab = LegacyItemDetailTab;

const tabs: { id: DetailTab; labelKey: TranslationKey; icon: typeof Info }[] = [
  { id: "info", labelKey: "items.information", icon: Info },
  { id: "edit", labelKey: "items.edit", icon: Edit3 },
  { id: "service", labelKey: "items.sendToService", icon: Wrench },
  { id: "writeoff", labelKey: "items.writeOff", icon: CheckSquare },
  { id: "delete", labelKey: "items.delete", icon: Trash2 },
];

export default function ItemDetails({
  item,
  canManage = false,
}: {
  item: InventoryItem;
  canManage?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("info");
  const { dataLabel, t } = useAppSettings();
  const visibility = legacyItemDetailVisibility(canManage);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-black/5 bg-white p-2">
        {tabs.filter((tab) => visibility.tabs.includes(tab.id)).map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${activeTab === tab.id ? "bg-emerald-50 text-emerald-700" : "text-zinc-500 hover:bg-zinc-50"}`}><Icon className="h-4 w-4" />{t(tab.labelKey)}</button>; })}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-amber-500" /><strong>{t("items.notMarked")}</strong> {t("items.createAndScanQr")}</span></div>
      <div className="flex items-center gap-3"><Link href="/items" className="rounded-lg p-2 text-zinc-500 hover:bg-white"><ArrowLeft className="h-5 w-5" /></Link><div><h1 className="text-2xl font-semibold text-zinc-800">{dataLabel(item.itemType ?? item.name)} {item.brandModel ?? ""}</h1><div className="mt-1"><LegacyDisplayStatusBadge value={item.displayStatus ?? "РђРєС‚РёРІРµРЅ"} /></div></div></div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,0.85fr)_minmax(520px,1.6fr)]">
        <InventoryAssetCard item={item} canGenerateQr={visibility.canGenerateQr} />
        {activeTab === "info" ? <InventoryInformationPanel /> : activeTab === "edit" ? <InventoryEditPanel item={item} /> : <InventoryActionPanel action={activeTab} />}
      </div>
      <div className="rounded-2xl border border-black/5 bg-white p-6"><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-emerald-500" /><h2 className="font-semibold">{t("items.equipment")}</h2></div><p className="mt-4 text-sm text-zinc-400">{t("items.equipmentEmpty")}</p></div>
    </div>
  );
}
