import { CheckSquare, Send, Trash2 } from "lucide-react";
import type { LegacyItemDetailTab } from "@/lib/item-detail-visibility";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";

type ActionType = Exclude<LegacyItemDetailTab, "info" | "edit">;

export default function InventoryActionPanel({ action }: { action: ActionType }) {
  const { t } = useAppSettings();
  const content = { service: { title: t("items.serviceTitle"), text: t("items.serviceText"), button: t("items.sendToService"), Icon: Send }, writeoff: { title: t("items.writeOffTitle"), text: t("items.writeOffText"), button: t("items.writeOff"), Icon: CheckSquare }, delete: { title: t("items.deleteTitle"), text: t("items.deleteText"), button: t("items.delete"), Icon: Trash2 } }[action];
  return <section className="rounded-2xl border border-black/5 bg-white p-7 shadow-sm"><div className="mx-auto max-w-xl text-center"><content.Icon className={`mx-auto h-20 w-20 ${action === "delete" ? "text-red-400" : "text-emerald-400"}`} strokeWidth={1.2} aria-hidden="true" /><h2 className="mt-4 text-xl font-semibold">{content.title}</h2><p className="mt-2 text-zinc-500">{content.text}</p></div>{action === "service" ? <div className="mx-auto mt-7 max-w-xl space-y-4"><input placeholder={t("items.serviceName")} className="w-full rounded-xl bg-slate-100 px-4 py-3 outline-none" /><textarea placeholder={t("items.reason")} rows={4} className="w-full resize-none rounded-xl bg-slate-100 px-4 py-3 outline-none" /></div> : <label className="mx-auto mt-7 flex max-w-xl items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-emerald-500" />{t("items.confirmAction")}</label>}<div className="mx-auto mt-6 w-fit"><Button variant={action === "delete" ? "danger" : "primary"} leadingIcon={content.Icon}>{content.button}</Button></div></section>;
}
