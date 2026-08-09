"use client";

import { Barcode, Camera, Keyboard, QrCode, ScanLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  startBarcodeScanner,
  type BarcodeScannerSession,
} from "@/lib/browser-barcode-scanner";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TranslationKey } from "@/lib/i18n";

export default function InventoryItemCodeScanner({
  onClose,
  onCodeSelected,
  mode = "default",
}: {
  onClose: () => void;
  onCodeSelected: (value: string) => void;
  mode?: "default" | "qr-only";
}) {
  const { t } = useAppSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scannerSessionRef = useRef<BarcodeScannerSession | null>(null);
  const cameraRequestRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const [manualValue, setManualValue] = useState("");
  const qrOnly = mode === "qr-only";
  const [format, setFormat] = useState<"code_39" | "qr_code">(
    qrOnly ? "qr_code" : "code_39",
  );
  const [messageKey, setMessageKey] = useState<TranslationKey>(
    qrOnly ? "scanner.aimQr" : "scanner.aimBarcode",
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      stop();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  function stop() {
    cameraRequestRef.current += 1;
    scannerSessionRef.current?.stop();
    scannerSessionRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function choose(value: string) {
    const code = value.trim();
    if (!code) return;
    stop();
    onCodeSelected(code);
  }

  async function startCamera() {
    stop();
    const requestId = ++cameraRequestRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessageKey("scanner.unsupportedManual");
      return;
    }
    try {
      const video = videoRef.current;
      if (!video || requestId !== cameraRequestRef.current) return;
      setMessageKey(
        format === "code_39"
          ? "scanner.cameraBarcode"
          : "scanner.cameraQr",
      );
      const session = await startBarcodeScanner({
        video,
        format,
        onDetected(value) {
          if (requestId === cameraRequestRef.current) choose(value);
        },
      });
      if (requestId !== cameraRequestRef.current) {
        session.stop();
        return;
      }
      scannerSessionRef.current = session;
    } catch {
      if (requestId === cameraRequestRef.current) {
        stop();
        setMessageKey("scanner.cameraDeniedManual");
      }
    }
  }

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[60] flex items-end justify-center bg-zinc-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="item-code-scanner-title">
      <section className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="item-code-scanner-title" className="text-lg font-semibold text-zinc-900">{t("scanner.itemTitle")}</h2><p className="mt-1 text-sm text-zinc-500">{t(qrOnly ? "tmc.qr.scannerHint" : "scanner.itemHint")}</p></div><button ref={closeButtonRef} type="button" onClick={() => { stop(); onClose(); }} aria-label={t("common.close")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button></div>
        {!qrOnly ? <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1">
          <button type="button" onClick={() => { stop(); setFormat("code_39"); setMessageKey("scanner.aimBarcode"); }} aria-pressed={format === "code_39"} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${format === "code_39" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}><Barcode className="h-4 w-4" />{t("itemDetails.barcode")}</button>
          <button type="button" onClick={() => { stop(); setFormat("qr_code"); setMessageKey("scanner.aimQr"); }} aria-pressed={format === "qr_code"} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${format === "qr_code" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}><QrCode className="h-4 w-4" />QR</button>
        </div> : null}
        <div className="relative mt-5 overflow-hidden rounded-2xl bg-zinc-950"><video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" /><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end gap-2 bg-gradient-to-t from-black/70 to-transparent px-5 pb-5 text-center text-sm text-white"><ScanLine className="h-6 w-6" /><span>{t(messageKey)}</span></div></div>
        <button type="button" onClick={() => void startCamera()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark"><Camera className="h-4 w-4" />{t("camera.open")}</button>
        <div className="mt-5 border-t border-zinc-100 pt-5"><label className="block text-sm font-medium text-zinc-700">{t("scanner.manual")}</label><div className="mt-2 flex gap-2"><input value={manualValue} onChange={(event) => setManualValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") choose(manualValue); }} placeholder={t("scanner.codePlaceholder")} className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" /><button type="button" onClick={() => choose(manualValue)} disabled={!manualValue.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 disabled:opacity-50"><Keyboard className="h-4 w-4" />{t(qrOnly ? "scanner.verify" : "scanner.add")}</button></div></div>
      </section>
    </div>
  );
}
