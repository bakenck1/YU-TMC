"use client";

import { Barcode, QrCode, ScanLine, X } from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryCodeKindSwitch, { type InventoryCodeKind } from "./InventoryCodeKindSwitch";

type QrDialogKind = "generate" | "scan" | "purpose";

export default function InventoryItemQrDialogs({
  kind,
  codeKind,
  onCodeKindChange,
  onClose,
  onPrint,
}: {
  kind: QrDialogKind | null;
  codeKind: InventoryCodeKind;
  onCodeKindChange(value: InventoryCodeKind): void;
  onClose(): void;
  onPrint(kind: InventoryCodeKind): void;
}) {
  const { t } = useAppSettings();
  if (!kind) return null;

  const title =
    kind === "generate"
      ? t(codeKind === "barcode" ? "code.generateBarcode" : "code.generateQr")
      : kind === "scan"
        ? t("code.scanHelp")
        : t("code.purpose");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              {kind === "scan" ? <ScanLine className="h-6 w-6" /> : codeKind === "barcode" ? <Barcode className="h-6 w-6" /> : <QrCode className="h-6 w-6" />}
            </div>
            <h2 className="text-lg font-semibold text-zinc-800">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>

        {kind === "generate" ? (
          <div className="mt-6 space-y-4 text-sm text-zinc-600">
            <p>{t("code.printHint")}</p>
            <InventoryCodeKindSwitch value={codeKind} onChange={onCodeKindChange} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-4 py-2 font-medium text-zinc-600">{t("common.cancel")}</button>
              <button type="button" onClick={() => onPrint(codeKind)} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-white hover:bg-emerald-600">{t("code.openForPrint")}</button>
            </div>
          </div>
        ) : kind === "scan" ? (
          <div className="mt-6 space-y-4">
            <InventoryCodeKindSwitch value={codeKind} onChange={onCodeKindChange} />
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-600">
              <li>{t("code.scanStep1")}</li>
              <li>{t("code.scanStep2")}</li>
              <li>{t("code.scanStep3")}</li>
            </ol>
          </div>
        ) : (
          <div className="mt-6 space-y-3 text-sm leading-6 text-zinc-600">
            <p>{t("code.purposeBarcode")}</p>
            <p>{t("code.purposeQr")}</p>
          </div>
        )}

        {kind !== "generate" ? (
          <div className="mt-6 flex justify-end"><button type="button" onClick={onClose} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">{t("code.understood")}</button></div>
        ) : null}
      </section>
    </div>
  );
}
