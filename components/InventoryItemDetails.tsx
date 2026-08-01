"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Barcode,
  Camera,
  Check,
  ChevronDown,
  Download,
  FileText,
  Image as ImageIcon,
  Pencil,
  Printer,
  QrCode,
  Save,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { InventoryItemAuditDto, InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { ResponsibilityTimelineEntryDto } from "@/lib/contracts/inventory-responsibility";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemQrDialogs from "@/components/InventoryItemQrDialogs";
import InventoryItemArchiveDialog from "@/components/InventoryItemArchiveDialog";
import InventoryItemServiceDialog from "@/components/InventoryItemServiceDialog";
import InventoryItemCameraCapture from "@/components/InventoryItemCameraCapture";
import InventoryItemComposition from "@/components/InventoryItemComposition";
import { translateCampusBuilding, type TranslationKey } from "@/lib/i18n";

export default function InventoryItemDetails({
  initialItem,
  canEditContent,
  canSendToService,
  timeline,
  audit,
  canManageProtected,
  rooms,
  initialComponents,
  canManageComponents,
}: {
  initialItem: InventoryItemDto;
  canEditContent: boolean;
  canSendToService: boolean;
  timeline: ResponsibilityTimelineEntryDto[];
  audit: InventoryItemAuditDto[];
  canManageProtected: boolean;
  rooms: RoomDto[];
  initialComponents: InventoryItemDto[];
  canManageComponents: boolean;
}) {
  const { language, locale, t } = useAppSettings();
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [itemType, setItemType] = useState(item.itemType);
  const [brand, setBrand] = useState(item.brand ?? "");
  const [model, setModel] = useState(item.model ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [protectedEditing, setProtectedEditing] = useState(false);
  const [protectedRoomId, setProtectedRoomId] = useState(item.room.id);
  const [inventoryNumber, setInventoryNumber] = useState(item.inventoryNumber);
  const [status, setStatus] = useState(item.status);
  const [replaceQr, setReplaceQr] = useState(false);
  const [qrReplaceReason, setQrReplaceReason] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [servicing, setServicing] = useState(false);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [qrDialog, setQrDialog] = useState<"generate" | "scan" | "purpose" | null>(null);
  const [codeKind, setCodeKind] = useState<"barcode" | "qr">("barcode");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const actionBarRef = useRef<HTMLElement>(null);
  const [actionBarHeight, setActionBarHeight] = useState(0);

  useEffect(() => {
    const actionBar = actionBarRef.current;
    if (!actionBar) return;
    const updateHeight = () =>
      setActionBarHeight(actionBar.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(actionBar);
    return () => observer.disconnect();
  }, []);

  async function saveContent() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: item.version,
          name,
          description: description || null,
          itemType,
          brand: brand || null,
          model: model || null,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
        }),
      });
      const body = (await response.json()) as {
        item?: InventoryItemDto;
        error?: string;
      };
      if (!response.ok || !body.item) {
        throw new Error(body.error ?? "save_failed");
      }
      setItem(body.item);
      setItemType(body.item.itemType);
      setBrand(body.item.brand ?? "");
      setModel(body.item.model ?? "");
      setQuantity(String(body.item.quantity));
      setUnitPrice(String(body.item.unitPrice));
      setEditing(false);
      setSaved(true);
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setSaving(false);
    }
  }

  function printCodeLabel(kind: "barcode" | "qr") {
    window.open(`/items/${item.id}/qr?kind=${kind}`, "_blank", "noopener,noreferrer");
    setQrDialog(null);
  }

  async function saveProtectedFields() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: item.version,
          roomId: protectedRoomId,
          inventoryNumber,
          status,
          replaceQr,
          qrReplaceReason: replaceQr ? qrReplaceReason : null,
        }),
      });
      const body = (await response.json()) as {
        item?: InventoryItemDto;
        error?: string;
      };
      if (!response.ok || !body.item) {
        throw new Error(body.error ?? "save_failed");
      }
      setItem(body.item);
      setProtectedRoomId(body.item.room.id);
      setInventoryNumber(body.item.inventoryNumber);
      setStatus(body.item.status);
      setProtectedEditing(false);
      setReplaceQr(false);
      setQrReplaceReason("");
      setSaved(true);
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setSaving(false);
    }
  }

  function openProtectedFields() {
    setProtectedRoomId(item.room.id);
    setInventoryNumber(item.inventoryNumber);
    setStatus(item.status);
    setReplaceQr(false);
    setQrReplaceReason("");
    setProtectedEditing(true);
  }

  function closeProtectedFields() {
    setProtectedRoomId(item.room.id);
    setInventoryNumber(item.inventoryNumber);
    setStatus(item.status);
    setReplaceQr(false);
    setQrReplaceReason("");
    setProtectedEditing(false);
  }

  async function archiveItem() {
    setArchiving(true);
    setError("");
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: item.version }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "archive_failed");
      }
      router.push("/items");
      router.refresh();
    } catch (cause) {
      setError(localizeItemError(cause, t));
      setArchiving(false);
    }
  }

  async function sendToService(input: { serviceName: string; reason: string }) {
    setServicing(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "send_to_service",
          version: item.version,
          serviceName: input.serviceName,
          reason: input.reason,
        }),
      });
      const body = (await response.json()) as {
        item?: InventoryItemDto;
        error?: string;
      };
      if (!response.ok || !body.item) {
        throw new Error(body.error ?? "service_failed");
      }
      setItem(body.item);
      setServiceDialogOpen(false);
      setSaved(true);
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setServicing(false);
    }
  }

  async function saveCameraPhoto(photo: {
    imageDataUrl: string;
    width: number;
    height: number;
  }) {
    setCapturingPhoto(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/inventory/items/${item.id}/photo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: item.version, ...photo }),
      });
      const body = (await response.json()) as { item?: InventoryItemDto; error?: string };
      if (!response.ok || !body.item) {
        throw new Error(body.error ?? "photo_save_failed");
      }
      setItem(body.item);
      setSaved(true);
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setCapturingPhoto(false);
    }
  }

  const statusLabel =
    item.status === "maintenance"
      ? t("itemDetails.statusMaintenance")
      : item.status === "decommissioned"
        ? t("itemDetails.statusDecommissioned")
        : t("itemDetails.statusActive");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/items" className="rounded-lg p-2 text-zinc-500 hover:bg-white">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-zinc-800">{item.name}</h1>
          <span className="mt-1 inline-block rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
            {statusLabel}
          </span>
        </div>
      </div>

      <nav
        ref={actionBarRef}
        aria-label={t("itemDetails.actions")}
        className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-white/95 p-2 shadow-md backdrop-blur"
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => document.getElementById("item-information")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <FileText className="h-4 w-4" /> {t("items.information")}
          </button>
          {canEditContent ? <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><Pencil className="h-4 w-4" />{t("items.edit")}</button> : null}
          <button type="button" onClick={() => { setCodeKind("barcode"); setQrDialog("generate"); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><Barcode className="h-4 w-4" />{t("itemDetails.barcode")}</button>
          {canManageProtected ? (
            <button
              type="button"
              onClick={() =>
                protectedEditing
                  ? closeProtectedFields()
                  : openProtectedFields()
              }
              aria-expanded={protectedEditing}
              aria-controls="protected-fields-panel"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <ShieldCheck className="h-4 w-4" />
              {t("itemDetails.protectedFields")}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${protectedEditing ? "rotate-180" : ""}`}
              />
            </button>
          ) : null}
        </div>
        {canSendToService || canManageProtected ? (
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {canSendToService ? <button type="button" onClick={() => setServiceDialogOpen(true)} disabled={servicing || item.status === "maintenance"} title={item.status === "maintenance" ? t("itemDetails.alreadyInService") : t("items.sendToService")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"><Wrench className="h-4 w-4" />{servicing ? t("itemDetails.sending") : item.status === "maintenance" ? t("itemDetails.inService") : t("items.sendToService")}</button> : null}
            {canManageProtected ? <button type="button" onClick={() => setArchiveConfirmationOpen(true)} disabled={archiving} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"><Trash2 className="h-4 w-4" />{t("items.writeOff")}</button> : null}
          </div>
        ) : null}
      </nav>

      {canManageProtected && protectedEditing ? (
        <section
          id="protected-fields-panel"
          aria-labelledby="protected-fields-title"
          className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm"
        >
          <div>
            <h2 id="protected-fields-title" className="font-semibold text-zinc-800">
              {t("itemDetails.protectedFields")}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t("itemDetails.protectedHint")}
            </p>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-zinc-600">{t("itemDetails.room")}</span>
              <select
                value={protectedRoomId}
                onChange={(event) => setProtectedRoomId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.designation} · {t("inventory.floorShort")} {room.floorNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">{t("itemDetails.officialNumber")}</span>
              <input
                value={inventoryNumber}
                onChange={(event) => setInventoryNumber(event.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">{t("items.status")}</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as InventoryItemDto["status"])
                }
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              >
                <option value="active">{t("itemDetails.statusActive")}</option>
                <option value="maintenance">{t("itemDetails.statusMaintenance")}</option>
                <option value="decommissioned">{t("itemDetails.statusDecommissioned")}</option>
              </select>
            </label>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2 text-zinc-700">
                <input
                  type="checkbox"
                  checked={replaceQr}
                  onChange={(event) => setReplaceQr(event.target.checked)}
                />
                {t("itemDetails.replaceCode")}
              </label>
              {replaceQr ? (
                <input
                  value={qrReplaceReason}
                  onChange={(event) => setQrReplaceReason(event.target.value)}
                  placeholder={t("itemDetails.replaceReason")}
                  maxLength={1000}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
                />
              ) : null}
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={() => void saveProtectedFields()}
                disabled={
                  saving ||
                  !protectedRoomId ||
                  !inventoryNumber.trim() ||
                  (replaceQr && !qrReplaceReason.trim())
                }
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? t("itemDetails.saving") : t("common.save")}
              </button>
              <button
                type="button"
                onClick={closeProtectedFields}
                className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm text-zinc-600"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> {t("itemDetails.saved")}
        </p>
      ) : null}
      <InventoryItemQrDialogs
        kind={qrDialog}
        codeKind={codeKind}
        onCodeKindChange={setCodeKind}
        onClose={() => setQrDialog(null)}
        onPrint={printCodeLabel}
      />
      <InventoryItemArchiveDialog
        itemName={item.name}
        open={archiveConfirmationOpen}
        saving={archiving}
        onClose={() => setArchiveConfirmationOpen(false)}
        onConfirm={() => void archiveItem()}
      />
      <InventoryItemServiceDialog
        open={serviceDialogOpen}
        saving={servicing}
        onClose={() => setServiceDialogOpen(false)}
        onSubmit={(input) => void sendToService(input)}
      />
      <InventoryItemCameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(photo) => {
          setCameraOpen(false);
          void saveCameraPhoto(photo);
        }}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(420px,1.4fr)]">
        <section className="overflow-hidden rounded-2xl border border-amber-100 bg-[#fff8ec]">
          <div className="relative flex aspect-[4/3] items-center justify-center bg-zinc-100">
            {item.photoUrl ? (
              <Image src={item.photoUrl} alt={item.name} fill unoptimized className="object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-sm text-zinc-400">
                <ImageIcon className="h-10 w-10" />
                {t("items.photoMissing")}
              </div>
            )}
            {canEditContent ? (
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                disabled={capturingPhoto}
                className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-zinc-800 shadow-lg transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60"
              >
                <Camera className="h-4 w-4" />
                {capturingPhoto ? t("itemDetails.saving") : t("items.photo")}
              </button>
            ) : null}
          </div>
          <div className="border-t border-amber-100 p-5">
            <div className="flex items-center justify-center gap-3 rounded-xl bg-white p-4">
              {codeKind === "barcode" || item.qrCode ? (
                <Image
                  src={`/api/inventory/items/${item.id}/qr?kind=${codeKind}&format=svg`}
                  alt={`${codeKind === "barcode" ? `${t("itemDetails.barcode")} Code 39` : t("items.qrCode")}: ${item.name}`}
                  width={codeKind === "barcode" ? 240 : 96}
                  height={96}
                  unoptimized
                  className={codeKind === "barcode" ? "max-w-[58%]" : undefined}
                />
              ) : null}
              <div className="min-w-0">
                <p className="text-xs text-zinc-400">{codeKind === "barcode" ? `${t("itemDetails.barcode")} Code 39` : t("items.qrCode")}</p>
                <p className="break-all font-mono text-xs text-zinc-700">
                  {codeKind === "barcode" ? item.inventoryNumber : item.qrCode ?? t("itemDetails.notAssigned")}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-white/70 p-1">
              <button type="button" onClick={() => setCodeKind("barcode")} aria-pressed={codeKind === "barcode"} className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold ${codeKind === "barcode" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}><Barcode className="h-4 w-4" />Code 39</button>
              <button type="button" onClick={() => setCodeKind("qr")} aria-pressed={codeKind === "qr"} className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold ${codeKind === "qr" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}><QrCode className="h-4 w-4" />QR</button>
            </div>
            {codeKind === "barcode" || item.qrCode ? (
              <div className="mt-3 grid grid-cols-2 gap-2 print:hidden">
                <a
                  href={`/api/inventory/items/${item.id}/qr?kind=${codeKind}&format=${codeKind === "barcode" ? "svg" : "png"}&download=1`}
                  className="flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-zinc-700"
                >
                  <Download className="h-4 w-4" /> {t("itemDetails.download")}
                </a>
                <Link
                  href={`/items/${item.id}/qr?kind=${codeKind}`}
                  className="flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-zinc-700"
                >
                  <Printer className="h-4 w-4" /> {t("itemDetails.print")}
                </Link>
              </div>
            ) : null}
            <div className="mt-3 grid gap-2 text-xs print:hidden">
              <button type="button" onClick={() => { setCodeKind("barcode"); setQrDialog("generate"); }} className="rounded-lg bg-emerald-500 px-3 py-2 font-semibold text-white hover:bg-emerald-600">{t("itemDetails.generateBarcode")}</button>
              <button type="button" onClick={() => setQrDialog("scan")} className="text-left font-medium text-emerald-700 underline underline-offset-2">{t("itemDetails.scanHelp")}</button>
              <button type="button" onClick={() => setQrDialog("purpose")} className="text-left font-medium text-emerald-700 underline underline-offset-2">{t("itemDetails.codePurpose")}</button>
            </div>
          </div>
        </section>

        <section
          id="item-information"
          style={{ scrollMarginTop: actionBarHeight + 16 }}
          className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm"
        >
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-800">{t("itemDetails.card")}</h2>
              <p className="mt-1 text-sm text-zinc-500">{t("itemDetails.currentRegistryData")}</p>
            </div>
            {canEditContent && !editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("itemDetails.change")}
              </button>
            ) : null}
          </div>

          {editing ? (
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="text-zinc-500">{t("items.name")}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm"><span className="text-zinc-500">{t("items.type")}</span><input value={itemType} onChange={(event) => setItemType(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">{t("itemDetails.brand")}</span><input value={brand} onChange={(event) => setBrand(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">{t("itemDetails.model")}</span><input value={model} onChange={(event) => setModel(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">{t("items.quantity")}</span><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm sm:col-span-2"><span className="text-zinc-500">{t("itemDetails.unitPriceCurrency")}</span><input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
              </div>
              <label className="block text-sm">
                <span className="text-zinc-500">{t("itemDetails.description")}</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveContent()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  <Save className="h-4 w-4" /> {saving ? t("itemDetails.saving") : t("common.save")}
                </button>
                <button type="button" onClick={() => { setEditing(false); setName(item.name); setDescription(item.description ?? ""); setItemType(item.itemType); setBrand(item.brand ?? ""); setModel(item.model ?? ""); setQuantity(String(item.quantity)); setUnitPrice(String(item.unitPrice)); }} className="rounded-lg border border-black/10 px-4 py-2 text-sm text-zinc-600">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("items.name")} value={item.name} />
              <Field label={t("items.type")} value={item.itemType} />
              <Field label={t("items.brandModelShort")} value={[item.brand, item.model].filter(Boolean).join(" / ") || t("common.notSpecified")} />
              <Field label={t("items.inventoryNumber")} value={`${item.inventoryNumber}${item.inventoryNumberKind === "temporary" ? ` (${t("itemDetails.temporaryNumber")})` : ""}`} />
              <Field label={t("itemDetails.room")} value={`${translateCampusBuilding(language, item.room.buildingName)}, ${item.room.designation}`} />
              <Field label={t("inventory.floor")} value={String(item.room.floorNumber)} />
              <Field label={t("items.status")} value={statusLabel} />
              <Field label={t("items.responsible")} value={item.responsible?.name || t("common.notAssigned")} />
              <Field label={t("items.quantity")} value={String(item.quantity)} />
              <Field label={t("itemDetails.unitPrice")} value={`${item.unitPrice.toFixed(2)} ₸`} />
              <Field label={t("itemDetails.recordVersion")} value={String(item.version)} />
              <Field label={t("items.updated")} value={new Date(item.updatedAt).toLocaleString(locale)} />
              <div className="sm:col-span-2">
                <Field label={t("itemDetails.description")} value={item.description || t("common.notSpecified")} />
              </div>
            </dl>
          )}
        </section>
      </div>

      <InventoryItemComposition
        key={item.id}
        itemId={item.id}
        initialComponents={initialComponents}
        canManage={canManageComponents}
      />

      {timeline.length ? (
        <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-800">{t("itemDetails.responsibilityHistory")}</h2>
          <ol className="mt-4 space-y-3">
            {timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-zinc-800">
                    {timelineTitle(entry, t)}
                  </p>
                  <time className="text-xs text-zinc-400" dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString(locale)}
                  </time>
                </div>
                <p className="mt-1 text-zinc-500">
                  {entry.actorName ? `${entry.actorName} → ` : ""}
                  {entry.responsibleName ?? t("common.notAssigned")}
                  {entry.detail ? ` · ${entry.detail}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {audit.length ? (
        <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-800">{t("itemDetails.auditHistory")}</h2>
          <ol className="mt-4 space-y-3">
            {audit.map((entry) => (
              <li key={entry.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-zinc-800">{auditActionLabel(entry.action, t)}</p>
                  <time className="text-xs text-zinc-400" dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString(locale)}
                  </time>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {entry.actorName ?? t("itemDetails.auditUnknownActor")}
                  {entry.actorId ? ` · ${entry.actorId}` : ""}
                  {entry.subjectRevision ? ` · ${t("itemDetails.auditRevision", { revision: entry.subjectRevision })}` : ""}
                </p>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <AuditSnapshot label={t("itemDetails.auditBefore")} values={entry.beforeValues} />
                  <AuditSnapshot label={t("itemDetails.auditAfter")} values={entry.afterValues} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function timelineTitle(
  entry: ResponsibilityTimelineEntryDto,
  t: (key: TranslationKey) => string,
) {
  if (entry.kind === "responsibility") {
    return entry.status === "transfer"
      ? t("itemDetails.responsibilityTransferred")
      : entry.status === "admin_override"
        ? t("itemDetails.responsibilityOverridden")
        : t("itemDetails.responsibilityAccepted");
  }
  const labels: Record<string, TranslationKey> = {
    pending_current_owner: "itemDetails.transferRequested",
    confirmed: "itemDetails.transferConfirmed",
    rejected: "itemDetails.transferRejected",
    cancelled: "itemDetails.transferCancelled",
    overridden: "itemDetails.transferOverridden",
  };
  return t(labels[entry.status] ?? "itemDetails.responsibilityTransfer");
}

function auditActionLabel(
  action: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const labels: Record<string, TranslationKey> = {
    "item.created": "itemDetails.auditCreated",
    "item.content_updated": "itemDetails.auditContentUpdated",
    "item.photo_captured": "itemDetails.auditPhotoCaptured",
    "item.protected_fields_updated": "itemDetails.auditProtectedUpdated",
    "item.archived": "itemDetails.auditArchived",
    "item.sent_to_service": "itemDetails.auditSentToService",
    "item.component_added": "itemDetails.auditComponentAdded",
    "item.component_removed": "itemDetails.auditComponentRemoved",
  };
  return t(labels[action] ?? "itemDetails.auditUnknownAction");
}

function AuditSnapshot({
  label,
  values,
}: {
  label: string;
  values: Record<string, unknown> | null;
}) {
  return (
    <div className="rounded-lg bg-white p-2">
      <p className="font-semibold text-zinc-400">{label}</p>
      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-zinc-600">
        {values ? JSON.stringify(values, null, 2) : "—"}
      </pre>
    </div>
  );
}

function localizeItemError(
  cause: unknown,
  t: (key: TranslationKey) => string,
) {
  void cause;
  return t("itemDetails.error");
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-zinc-800">{value}</dd>
    </div>
  );
}
