"use client";

import { AlertTriangle, X } from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function InventoryItemArchiveDialog({
  itemName,
  open,
  saving,
  onClose,
  onConfirm,
}: {
  itemName: string;
  open: boolean;
  saving: boolean;
  onClose(): void;
  onConfirm(): void;
}) {
  const { t } = useAppSettings();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={t("archive.title")}>
      <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" /><div><h2 className="text-lg font-semibold text-zinc-800">{t("archive.question")}</h2><p className="mt-2 text-sm leading-6 text-zinc-600">{t("archive.description", { name: itemName })}</p></div></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t("common.close")} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-zinc-600">{t("common.cancel")}</button>
          <button type="button" onClick={onConfirm} disabled={saving} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{saving ? t("archive.archiving") : t("archive.confirm")}</button>
        </div>
      </section>
    </div>
  );
}
