"use client";

import { useMemo, useState } from "react";
import { Camera, CheckCircle2, Plus, ScanLine, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";
import InventoryItemCameraCapture from "@/components/InventoryItemCameraCapture";

export default function InventoryItemCreateForm({
  rooms,
  buildings = [],
  initialRoomId,
  openInitially = false,
  hideTrigger = false,
  restricted = false,
  onCreated,
  onDismiss,
}: {
  rooms: RoomDto[];
  buildings?: BuildingDto[];
  initialRoomId?: string;
  openInitially?: boolean;
  hideTrigger?: boolean;
  /** When true (warehouse role) — only name, description, room and photo are shown. */
  restricted?: boolean;
  onCreated?: () => void;
  onDismiss?: () => void;
}) {
  const router = useRouter();
  const { t } = useAppSettings();
  const [open, setOpen] = useState(openInitially);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const initialRoom = rooms.find((room) => room.id === initialRoomId) ?? rooms[0];
  const [buildingId, setBuildingId] = useState(initialRoom?.buildingId ?? "");
  const [roomId, setRoomId] = useState(initialRoom?.id ?? "");
  const [barcode, setBarcode] = useState("");
  const [codeScannerOpen, setCodeScannerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photo, setPhoto] = useState<{ imageDataUrl: string; width: number; height: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const buildingRooms = useMemo(
    () => rooms.filter((room) => room.buildingId === buildingId),
    [buildingId, rooms],
  );
  const showBuildingSelector = buildings.length > 0 && !initialRoomId;
  const visibleRooms = showBuildingSelector ? buildingRooms : rooms;

  if (rooms.length === 0) return null;

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          itemType: restricted ? null : (itemType || null),
          brand: restricted ? null : (brand || null),
          model: restricted ? null : (model || null),
          quantity: restricted ? 1 : Number(quantity),
          unitPrice: restricted ? 0 : (unitPrice === "" ? 0 : Number(unitPrice)),
          roomId,
          barcode: restricted ? null : (barcode || null),
          photo,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "create_failed");
      setOpen(false);
      setName("");
      setDescription("");
      setItemType("");
      setBrand("");
      setModel("");
      setQuantity("1");
      setUnitPrice("");
      setBarcode("");
      setPhoto(null);
      onCreated?.();
      router.refresh();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "create_failed";
      const messageKey =
        code === "inventory_number_already_exists"
          ? "itemDetails.errorInventoryNumber"
          : code === "room_not_found"
            ? "itemDetails.errorRoomNotFound"
            : code === "forbidden"
              ? "itemDetails.errorForbidden"
              : code === "version_conflict"
                ? "itemDetails.errorConflict"
                : code === "invalid_barcode" ||
                    code === "invalid_request" ||
                    code === "ambiguous_item_code" ||
                    code === "barcode_belongs_to_existing_item"
                  ? "itemDetails.errorInvalidFields"
                  : code === "items_unavailable" || code === "internal_error"
                    ? "itemDetails.errorUnavailable"
                    : "itemDetails.error";
      setError(t(messageKey));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {!hideTrigger ? (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600">
        <Plus className="h-4 w-4" /> {t("createItem.add")}
      </button>
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={t("createItem.add")}>
          <div className="max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-800">{t("createItem.new")}</h2>
              <button type="button" onClick={() => { setOpen(false); onDismiss?.(); }} aria-label={t("common.close")} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>
            {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <div className="mt-5 space-y-4">
              {!restricted && (
                <button type="button" onClick={() => setCodeScannerOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"><ScanLine className="h-4 w-4" />{t("createItem.scan")}</button>
              )}
              <label className="block text-sm"><span className="text-zinc-500">{t("items.name")}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
              <label className="block text-sm"><span className="text-zinc-500">{t("itemDetails.description")}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
              {!restricted && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm"><span className="text-zinc-500">{t("items.type")}</span><input value={itemType} onChange={(event) => setItemType(event.target.value)} placeholder={t("createItem.typePlaceholder")} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                  <label className="block text-sm"><span className="text-zinc-500">{t("itemDetails.brand")}</span><input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder={t("createItem.brandPlaceholder")} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                  <label className="block text-sm"><span className="text-zinc-500">{t("itemDetails.model")}</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t("createItem.modelPlaceholder")} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                  <label className="block text-sm"><span className="text-zinc-500">{t("items.quantity")}</span><input type="number" min="1" max="1000000" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                  <label className="block text-sm sm:col-span-2"><span className="text-zinc-500">{t("itemDetails.unitPriceCurrency")}</span><input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="0" className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                </div>
              )}
              {showBuildingSelector ? (
                <label className="block text-sm">
                  <span className="text-zinc-500">{t("analytics.buildingFilter")}</span>
                  <select
                    value={buildingId}
                    onChange={(event) => {
                      const nextBuildingId = event.target.value;
                      setBuildingId(nextBuildingId);
                      setRoomId(rooms.find((room) => room.buildingId === nextBuildingId)?.id ?? "");
                    }}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 outline-none focus:border-emerald-500"
                  >
                    {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="block text-sm"><span className="text-zinc-500">{t("itemDetails.room")}</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 outline-none focus:border-emerald-500">{visibleRooms.map((room) => <option key={room.id} value={room.id}>{room.designation} · {t("inventory.floorShort")} {room.floorNumber}</option>)}</select></label>
              {!restricted && (
                <label className="block text-sm"><span className="text-zinc-500">{t("createItem.barcode")} <span className="text-red-600">({t("createItem.required")})</span></span><input required value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder={t("createItem.barcodePlaceholder")} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /><span className="mt-1 block text-xs text-zinc-500">{t("createItem.barcodeHint")}</span></label>
              )}
              <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 p-4">
                <p className="text-base font-medium text-zinc-800">{t("items.photo")} {!restricted && <span className="text-red-600">({t("createItem.required")})</span>}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setCameraOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800"><Camera className="h-4 w-4" />{t("camera.open")}</button>
                  <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-emerald-300 bg-white px-3 text-center text-sm font-semibold text-emerald-800">{t("service.attachPhoto")}<input type="file" accept="image/jpeg" className="sr-only" onChange={(event) => void readJpeg(event.target.files?.[0]).then(setPhoto).catch(() => setError(t("common.error")))} /></label>
                </div>
                {photo ? <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" />{t("service.photoAttached")}</p> : null}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => { setOpen(false); onDismiss?.(); }} className="rounded-lg border border-black/10 px-4 py-2 text-sm text-zinc-600">{t("common.cancel")}</button>
              <button type="button" onClick={() => void submit()} disabled={saving || !name.trim() || !roomId || (!restricted && (!itemType.trim() || !barcode.trim() || !photo))} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? t("createItem.creating") : t("createItem.create")}</button>
            </div>

            {codeScannerOpen ? (
              <InventoryItemCodeScanner
                onClose={() => setCodeScannerOpen(false)}
                onCodeSelected={(value) => {
                  setBarcode(value);
                  setCodeScannerOpen(false);
                }}
              />
            ) : null}
            <InventoryItemCameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(value) => { setPhoto(value); setCameraOpen(false); }} />
          </div>
        </div>
      ) : null}
    </>
  );
}

async function readJpeg(file: File | undefined) {
  if (!file || file.type !== "image/jpeg" || file.size > 5 * 1024 * 1024) throw new Error("invalid_photo");
  const imageDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = imageDataUrl;
  });
  return { imageDataUrl, ...dimensions };
}
