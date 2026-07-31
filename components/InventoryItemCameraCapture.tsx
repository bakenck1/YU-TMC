"use client";

import { Camera, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppSettings } from "@/components/AppSettingsProvider";

export default function InventoryItemCameraCapture({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose(): void;
  onCapture(photo: { imageDataUrl: string; width: number; height: number }): void;
}) {
  const { t } = useAppSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [messageKey, setMessageKey] = useState<Parameters<typeof t>[0]>("camera.initial");
  const [starting, setStarting] = useState(false);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessageKey("camera.unavailable");
      return;
    }
    setStarting(true);
    setMessageKey("camera.requesting");
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 960, max: 1920 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setMessageKey("camera.aim");
    } catch {
      setMessageKey("camera.denied");
    } finally {
      setStarting(false);
    }
  }

  function close() {
    stopCamera();
    onClose();
  }

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      setMessageKey("camera.notReady");
      return;
    }
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setMessageKey("camera.prepareFailed");
      return;
    }
    context.drawImage(video, 0, 0, width, height);
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.82);
    stopCamera();
    onCapture({ imageDataUrl, width, height });
  }

  useEffect(() => () => stopCamera(), []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="item-camera-title">
      <section className="w-full max-w-xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="item-camera-title" className="text-lg font-semibold text-zinc-900">{t("camera.itemTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t("camera.onlyDevice")}</p>
          </div>
          <button type="button" onClick={close} aria-label={t("common.close")} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative mt-5 overflow-hidden rounded-2xl bg-zinc-950">
          <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-4 inset-y-5 rounded-xl border-2 border-white/70" />
        </div>
        <p className="mt-3 text-center text-sm text-zinc-600">{t(messageKey)}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => void startCamera()} disabled={starting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" />{t("camera.open")}</button>
          <button type="button" onClick={capture} disabled={starting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Camera className="h-4 w-4" />{t("camera.capture")}</button>
        </div>
      </section>
    </div>
  );
}
