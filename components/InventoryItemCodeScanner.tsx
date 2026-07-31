"use client";

import { Barcode, Camera, Keyboard, QrCode, ScanLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Detector = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>> };
type DetectorConstructor = {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

export default function InventoryItemCodeScanner({ onClose, onCodeSelected }: { onClose: () => void; onCodeSelected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cameraRequestRef = useRef(0);
  const [manualValue, setManualValue] = useState("");
  const [format, setFormat] = useState<"code_39" | "qr_code">("code_39");
  const [message, setMessage] = useState("Наведите камеру на штрих-код Code 39.");

  useEffect(() => () => stop(), []);

  function stop() {
    cameraRequestRef.current += 1;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
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
    const DetectorClass = (window as typeof window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!DetectorClass || !navigator.mediaDevices?.getUserMedia) {
      setMessage("Сканирование камерой не поддерживается. Введите код вручную.");
      return;
    }
    try {
      const supportedFormats = await DetectorClass.getSupportedFormats?.();
      if (requestId !== cameraRequestRef.current) return;
      if (supportedFormats && !supportedFormats.includes(format)) {
        setMessage(
          format === "code_39"
            ? "Этот браузер не распознаёт Code 39. Выберите QR или введите код вручную."
            : "Этот браузер не распознаёт QR. Выберите Code 39 или введите код вручную.",
        );
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (requestId !== cameraRequestRef.current) return;
      const detector = new DetectorClass({ formats: [format] });
      setMessage(
        format === "code_39"
          ? "Камера включена. Наведите её на штрих-код Code 39."
          : "Камера включена. Наведите её на QR-код.",
      );
      timerRef.current = window.setInterval(() => {
        void detector.detect(video).then((items) => {
          if (requestId !== cameraRequestRef.current) return;
          const value = items[0]?.rawValue;
          if (value) choose(value);
        }).catch(() => undefined);
      }, 500);
    } catch {
      if (requestId === cameraRequestRef.current) {
        stop();
        setMessage("Нет доступа к камере. Введите код вручную.");
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-zinc-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="item-code-scanner-title">
      <section className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="item-code-scanner-title" className="text-lg font-semibold text-zinc-900">Сканировать код предмета</h2><p className="mt-1 text-sm text-zinc-500">По умолчанию распознаётся Code 39; QR доступен отдельно.</p></div><button type="button" onClick={() => { stop(); onClose(); }} aria-label="Закрыть" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button></div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1">
          <button type="button" onClick={() => { stop(); setFormat("code_39"); setMessage("Наведите камеру на штрих-код Code 39."); }} aria-pressed={format === "code_39"} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${format === "code_39" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}><Barcode className="h-4 w-4" />Code 39</button>
          <button type="button" onClick={() => { stop(); setFormat("qr_code"); setMessage("Наведите камеру на QR-код."); }} aria-pressed={format === "qr_code"} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${format === "qr_code" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}><QrCode className="h-4 w-4" />QR</button>
        </div>
        <div className="relative mt-5 overflow-hidden rounded-2xl bg-zinc-950"><video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" /><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end gap-2 bg-gradient-to-t from-black/70 to-transparent px-5 pb-5 text-center text-sm text-white"><ScanLine className="h-6 w-6" /><span>{message}</span></div></div>
        <button type="button" onClick={() => void startCamera()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark"><Camera className="h-4 w-4" />Открыть камеру</button>
        <div className="mt-5 border-t border-zinc-100 pt-5"><label className="block text-sm font-medium text-zinc-700">Или введите код вручную</label><div className="mt-2 flex gap-2"><input value={manualValue} onChange={(event) => setManualValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") choose(manualValue); }} placeholder="Код на наклейке" className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" /><button type="button" onClick={() => choose(manualValue)} disabled={!manualValue.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 disabled:opacity-50"><Keyboard className="h-4 w-4" />Добавить</button></div></div>
      </section>
    </div>
  );
}
