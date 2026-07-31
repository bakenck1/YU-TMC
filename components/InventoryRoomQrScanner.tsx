"use client";

import {
  Camera,
  Keyboard,
  LoaderCircle,
  ScanLine,
  SwitchCamera,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import {
  startBarcodeScanner,
  type BarcodeScannerSession,
} from "@/lib/browser-barcode-scanner";

interface ScannedRoom {
  id: string;
  designation: string;
  buildingName: string;
}

export default function InventoryRoomQrScanner({
  onClose,
  onRoomResolved,
}: {
  onClose: () => void;
  onRoomResolved: (room: ScannedRoom) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerSessionRef = useRef<BarcodeScannerSession | null>(null);
  const cameraRequestRef = useRef(0);
  const [manualValue, setManualValue] = useState("");
  const [cameraState, setCameraState] = useState<
    "idle" | "starting" | "active" | "unsupported" | "denied"
  >("idle");
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => {
        if (!cancelled) {
          setCanSwitchCamera(
            devices.filter((device) => device.kind === "videoinput").length > 1,
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  function stopCamera() {
    cameraRequestRef.current += 1;
    scannerSessionRef.current?.stop();
    scannerSessionRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
  }

  async function startCamera(nextFacingMode = facingMode) {
    stopCamera();
    const requestId = ++cameraRequestRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }

    setMessage(null);
    setCameraState("starting");
    try {
      const video = videoRef.current;
      if (!video || requestId !== cameraRequestRef.current) {
        setCameraState("idle");
        return;
      }
      const session = await startBarcodeScanner({
        video,
        format: "qr_code",
        facingMode: nextFacingMode,
        onDetected(value) {
          if (requestId !== cameraRequestRef.current) return;
          stopCamera();
          void resolveCode(value);
        },
      });
      if (requestId !== cameraRequestRef.current) {
        session.stop();
        return;
      }
      scannerSessionRef.current = session;
      setFacingMode(nextFacingMode);
      setCameraState("active");
    } catch {
      if (requestId === cameraRequestRef.current) {
        stopCamera();
        setCameraState("denied");
      }
    }
  }

  async function switchCamera() {
    await startCamera(facingMode === "environment" ? "user" : "environment");
  }

  async function resolveCode(value: string) {
    const normalized = value.trim();
    if (!normalized || resolving) return;
    setResolving(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/inventory/qr/resolve?value=${encodeURIComponent(normalized)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const body = (await response.json().catch(() => null)) as
        | { resolution?: QrResolutionDto; error?: string }
        | null;
      const resolution = body?.resolution;
      if (!response.ok || !resolution) {
        setMessage("Не удалось проверить код. Повторите сканирование или введите код вручную.");
        return;
      }
      if (resolution.status !== "resolved" || !resolution.target) {
        setMessage("Этот QR-код не зарегистрирован или больше не действует.");
        return;
      }
      if (resolution.target.kind !== "room") {
        setMessage(
          resolution.target.kind === "item"
            ? "Этот QR-код относится к предмету. Сначала отсканируйте QR-код кабинета."
            : "Это QR-код корпуса. Отсканируйте QR-код нужного кабинета.",
        );
        return;
      }
      onRoomResolved({
        id: resolution.target.id,
        designation: resolution.target.roomDesignation ?? resolution.target.title,
        buildingName: resolution.target.buildingName ?? "Корпус",
      });
    } catch {
      setMessage("Нет соединения с сервером. Можно ввести код ещё раз.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="room-qr-scanner-title">
      <section className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="room-qr-scanner-title" className="text-lg font-semibold text-zinc-900">Сканировать QR кабинета</h2>
            <p className="mt-1 text-sm text-zinc-500">После выбора кабинета предмет будет добавлен именно в него.</p>
          </div>
          <button type="button" onClick={() => { stopCamera(); onClose(); }} aria-label="Закрыть" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl bg-zinc-950">
          <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
          {cameraState !== "active" ? <div className="flex aspect-video flex-col items-center justify-center gap-3 px-5 text-center text-sm text-zinc-300"><ScanLine className="h-9 w-9" /><span>{cameraState === "unsupported" ? "Камера или QR-распознавание не поддерживаются этим браузером." : cameraState === "denied" ? "Доступ к камере не разрешён." : "Включите камеру для сканирования QR-кода."}</span></div> : null}
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => void startCamera()} disabled={cameraState === "starting" || cameraState === "active"} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50">
            {cameraState === "starting" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {cameraState === "active" ? "Камера включена" : "Открыть камеру"}
          </button>
          <button type="button" onClick={() => void switchCamera()} disabled={cameraState === "starting"} aria-label="Переключить камеру" title={canSwitchCamera ? "Переключить камеру" : "Попробовать другую доступную камеру"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
            <SwitchCamera className="h-4 w-4" />
            {facingMode === "environment" ? "Задняя" : "Передняя"}
          </button>
        </div>

        <div className="mt-5 border-t border-zinc-100 pt-5">
          <label className="block text-sm font-medium text-zinc-700">Не удалось отсканировать? Введите код кабинета вручную</label>
          <div className="mt-2 flex gap-2">
            <input value={manualValue} onChange={(event) => setManualValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void resolveCode(manualValue); }} placeholder="Например, YUQ1:..." className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            <button type="button" onClick={() => void resolveCode(manualValue)} disabled={resolving || !manualValue.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 disabled:opacity-50"><Keyboard className="h-4 w-4" />Проверить</button>
          </div>
        </div>
        {message ? <p role="alert" className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{message}</p> : null}
      </section>
    </div>
  );
}
