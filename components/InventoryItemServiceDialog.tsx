"use client";

import { Wrench, X } from "lucide-react";
import { useState } from "react";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function InventoryItemServiceDialog({
  open,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  saving: boolean;
  onClose(): void;
  onSubmit(input: { serviceName: string; reason: string }): void;
}) {
  if (!open) return null;
  return <ServiceDialogForm saving={saving} onClose={onClose} onSubmit={onSubmit} />;
}

function ServiceDialogForm({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  onClose(): void;
  onSubmit(input: { serviceName: string; reason: string }): void;
}) {
  const { t } = useAppSettings();
  const [serviceName, setServiceName] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={t("items.sendToService")}>
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-amber-50 p-2 text-amber-600"><Wrench className="h-6 w-6" /></div><div><h2 className="text-lg font-semibold text-zinc-800">{t("items.serviceTitle")}</h2><p className="mt-1 text-sm text-zinc-500">{t("service.subtitle")}</p></div></div><button type="button" onClick={onClose} disabled={saving} aria-label={t("common.close")} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button></div>
        <div className="mt-6 space-y-4">
          <label className="block text-sm"><span className="text-zinc-600">{t("items.serviceName")}</span><input autoFocus value={serviceName} onChange={(event) => setServiceName(event.target.value)} maxLength={160} placeholder={t("service.namePlaceholder")} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-amber-500" /></label>
          <label className="block text-sm"><span className="text-zinc-600">{t("items.reason")}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={4} placeholder={t("service.reasonPlaceholder")} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-amber-500" /></label>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-zinc-600">{t("common.cancel")}</button><button type="button" onClick={() => onSubmit({ serviceName, reason })} disabled={saving || !serviceName.trim() || !reason.trim()} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">{saving ? t("itemDetails.sending") : t("items.sendToService")}</button></div>
      </section>
    </div>
  );
}
