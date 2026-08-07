"use client";

import { Camera, CheckCircle2, ImagePlus, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import type { RoomWorkspaceItemDto } from "@/lib/contracts/room-workspace";
import type { ServiceRequestType } from "@/lib/contracts/inventory-domain";
import InventoryItemCameraCapture from "@/components/InventoryItemCameraCapture";
import { useAppSettings } from "@/components/AppSettingsProvider";

type Photo = { imageDataUrl: string; width: number; height: number };

export default function ProblemReportButton({
  items,
  initialItemId,
  className = "",
}: {
  items: Array<Pick<RoomWorkspaceItemDto, "id" | "name" | "inventoryNumber">>;
  initialItemId?: string;
  className?: string;
}) {
  const { t } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [itemId, setItemId] = useState(initialItemId ?? items[0]?.id ?? "");
  const [type, setType] = useState<ServiceRequestType>("not_working");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<"success" | "error" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!itemId || !description.trim() || !photo || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, type, description, photo }),
      });
      if (!response.ok) throw new Error();
      setMessage("success");
      setDescription("");
      setPhoto(null);
    } catch {
      setMessage("error");
    } finally {
      setSaving(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("error");
      return;
    }
    const imageDataUrl = await fileDataUrl(file);
    const dimensions = await imageDimensions(imageDataUrl);
    setPhoto({ imageDataUrl, ...dimensions });
    setMessage(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-amber-600 ${className}`}
      >
        <TriangleAlert className="h-5 w-5" /> {t("request.report")}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[65] flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("request.report")}>
          <section className="max-h-[100dvh] w-full overflow-y-auto bg-white p-5 sm:max-w-lg sm:rounded-3xl sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold text-zinc-900">{t("request.report")}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-base text-zinc-700">
                <span>{t("request.problemItem")}</span>
                <select value={itemId} onChange={(event) => setItemId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base">
                  {items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.inventoryNumber}</option>)}
                </select>
              </label>
              <label className="block text-base text-zinc-700">
                <span>{t("request.type")}</span>
                <select value={type} onChange={(event) => setType(event.target.value as ServiceRequestType)} className="mt-1 min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base">
                  {(["not_working", "not_connected", "damaged", "missing"] as const).map((value) => <option key={value} value={value}>{t(`request.type.${value}`)}</option>)}
                </select>
              </label>
              <label className="block text-base text-zinc-700">
                <span>{t("request.description")}</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={5} className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-3 text-base" />
              </label>
              <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4">
                <p className="text-base font-medium text-zinc-800">{t("request.photo")} *</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setCameraOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 font-semibold text-amber-800"><Camera className="h-5 w-5" />{t("camera.open")}</button>
                  <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 font-semibold text-amber-800"><ImagePlus className="h-5 w-5" />{t("service.attachPhoto")}</button>
                </div>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} />
                {photo ? <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" />{t("service.photoAttached")}</p> : null}
              </div>
              {message === "success" ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800">{t("request.sent")}</p> : null}
              {message === "error" ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{t("common.error")}</p> : null}
              <button type="button" onClick={() => void submit()} disabled={saving || !itemId || !description.trim() || !photo} className="min-h-12 w-full rounded-xl bg-amber-500 px-4 text-base font-semibold text-white disabled:opacity-50">{saving ? t("common.loading") : t("request.send")}</button>
            </div>
          </section>
        </div>
      ) : null}
      <InventoryItemCameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(value) => { setPhoto(value); setCameraOpen(false); setMessage(null); }} />
    </>
  );
}

function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageDimensions(source: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = source;
  });
}
