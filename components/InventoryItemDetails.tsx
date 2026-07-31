"use client";

import { useState } from "react";
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
import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { ResponsibilityTimelineEntryDto } from "@/lib/contracts/inventory-responsibility";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemQrDialogs from "@/components/InventoryItemQrDialogs";
import InventoryItemArchiveDialog from "@/components/InventoryItemArchiveDialog";
import InventoryItemServiceDialog from "@/components/InventoryItemServiceDialog";
import InventoryItemCameraCapture from "@/components/InventoryItemCameraCapture";

export default function InventoryItemDetails({
  initialItem,
  canEditContent,
  canSendToService,
  timeline,
  canManageProtected,
  rooms,
}: {
  initialItem: InventoryItemDto;
  canEditContent: boolean;
  canSendToService: boolean;
  timeline: ResponsibilityTimelineEntryDto[];
  canManageProtected: boolean;
  rooms: RoomDto[];
}) {
  const { t } = useAppSettings();
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
      setError(cause instanceof Error ? cause.message : "save_failed");
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
      setError(cause instanceof Error ? cause.message : "save_failed");
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
      setError(cause instanceof Error ? cause.message : "archive_failed");
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
      setError(cause instanceof Error ? cause.message : "service_failed");
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
      setError(cause instanceof Error ? cause.message : "photo_save_failed");
    } finally {
      setCapturingPhoto(false);
    }
  }

  const statusLabel =
    item.status === "maintenance"
      ? "На обслуживании"
      : item.status === "decommissioned"
        ? "Списан"
        : "Активен";

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

      <nav aria-label="Действия с предметом" className="flex flex-wrap gap-2 rounded-xl border border-black/5 bg-white p-2 shadow-sm">
        <button
          type="button"
          onClick={() => document.getElementById("item-information")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <FileText className="h-4 w-4" /> Информация
        </button>
        {canEditContent ? <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><Pencil className="h-4 w-4" />Редактировать</button> : null}
        <button type="button" onClick={() => { setCodeKind("barcode"); setQrDialog("generate"); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><Barcode className="h-4 w-4" />Штрих-код</button>
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
            Защищённые поля
            <ChevronDown
              className={`h-4 w-4 transition-transform ${protectedEditing ? "rotate-180" : ""}`}
            />
          </button>
        ) : null}
        {canSendToService ? <button type="button" onClick={() => setServiceDialogOpen(true)} disabled={item.status === "maintenance"} title={item.status === "maintenance" ? "Предмет уже находится в сервисе" : "Отправить предмет в сервис"} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"><Wrench className="h-4 w-4" />{item.status === "maintenance" ? "В сервисе" : "В сервис"}</button> : null}
        {canManageProtected ? <button type="button" onClick={() => setArchiveConfirmationOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><Trash2 className="h-4 w-4" />Списать</button> : null}
      </nav>

      {canManageProtected && protectedEditing ? (
        <section
          id="protected-fields-panel"
          aria-labelledby="protected-fields-title"
          className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm"
        >
          <div>
            <h2 id="protected-fields-title" className="font-semibold text-zinc-800">
              Защищённые поля
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Изменения доступны только администратору и сохраняются в аудите.
            </p>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-zinc-600">Кабинет</span>
              <select
                value={protectedRoomId}
                onChange={(event) => setProtectedRoomId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.designation} · этаж {room.floorNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">Официальный номер</span>
              <input
                value={inventoryNumber}
                onChange={(event) => setInventoryNumber(event.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">Статус</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as InventoryItemDto["status"])
                }
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              >
                <option value="active">Активен</option>
                <option value="maintenance">На обслуживании</option>
                <option value="decommissioned">Списан</option>
              </select>
            </label>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2 text-zinc-700">
                <input
                  type="checkbox"
                  checked={replaceQr}
                  onChange={(event) => setReplaceQr(event.target.checked)}
                />
                Заменить QR-код / штрих-код
              </label>
              {replaceQr ? (
                <input
                  value={qrReplaceReason}
                  onChange={(event) => setQrReplaceReason(event.target.value)}
                  placeholder="Обязательная причина замены"
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
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              <button
                type="button"
                onClick={closeProtectedFields}
                className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm text-zinc-600"
              >
                Отмена
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
          <Check className="h-4 w-4" /> Сохранено
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
                Фото не добавлено
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
                {capturingPhoto ? "Сохранение…" : "Фото"}
              </button>
            ) : null}
          </div>
          <div className="border-t border-amber-100 p-5">
            <div className="flex items-center justify-center gap-3 rounded-xl bg-white p-4">
              {codeKind === "barcode" || item.qrCode ? (
                <Image
                  src={`/api/inventory/items/${item.id}/qr?kind=${codeKind}&format=svg`}
                  alt={`${codeKind === "barcode" ? "Штрих-код Code 39" : "QR-код"}: ${item.name}`}
                  width={codeKind === "barcode" ? 240 : 96}
                  height={96}
                  unoptimized
                  className={codeKind === "barcode" ? "max-w-[58%]" : undefined}
                />
              ) : null}
              <div className="min-w-0">
                <p className="text-xs text-zinc-400">{codeKind === "barcode" ? "Штрих-код Code 39" : "QR-код"}</p>
                <p className="break-all font-mono text-xs text-zinc-700">
                  {codeKind === "barcode" ? item.inventoryNumber : item.qrCode ?? "Не назначен"}
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
                  <Download className="h-4 w-4" /> Скачать
                </a>
                <Link
                  href={`/items/${item.id}/qr?kind=${codeKind}`}
                  className="flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-zinc-700"
                >
                  <Printer className="h-4 w-4" /> Печать
                </Link>
              </div>
            ) : null}
            <div className="mt-3 grid gap-2 text-xs print:hidden">
              <button type="button" onClick={() => { setCodeKind("barcode"); setQrDialog("generate"); }} className="rounded-lg bg-emerald-500 px-3 py-2 font-semibold text-white hover:bg-emerald-600">Генерация штрих-кода</button>
              <button type="button" onClick={() => setQrDialog("scan")} className="text-left font-medium text-emerald-700 underline underline-offset-2">Как сканировать код?</button>
              <button type="button" onClick={() => setQrDialog("purpose")} className="text-left font-medium text-emerald-700 underline underline-offset-2">Для чего нужен код ТМЦ?</button>
            </div>
          </div>
        </section>

        <section id="item-information" className="scroll-mt-6 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-800">Карточка предмета</h2>
              <p className="mt-1 text-sm text-zinc-500">Актуальные данные из реестра</p>
            </div>
            {canEditContent && !editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Изменить
              </button>
            ) : null}
            {canSendToService || canManageProtected ? (
              <div className="flex flex-wrap justify-end gap-2">
                {canSendToService ? <button type="button" onClick={() => setServiceDialogOpen(true)} disabled={servicing || item.status === "maintenance"} className="rounded-lg border border-amber-200 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">{servicing ? "Отправка…" : item.status === "maintenance" ? "В сервисе" : "Отправить в сервис"}</button> : null}
                {canManageProtected ? <button type="button" onClick={() => setArchiveConfirmationOpen(true)} disabled={archiving} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"><span className="inline-flex items-center gap-2"><Trash2 className="h-4 w-4" />Списать и архивировать</span></button> : null}
              </div>
            ) : null}
          </div>

          {editing ? (
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="text-zinc-500">{t("items.name")}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm"><span className="text-zinc-500">Тип ТМЦ</span><input value={itemType} onChange={(event) => setItemType(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">Бренд</span><input value={brand} onChange={(event) => setBrand(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">Модель</span><input value={model} onChange={(event) => setModel(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">Количество</span><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm sm:col-span-2"><span className="text-zinc-500">Цена за единицу, ₸</span><input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
              </div>
              <label className="block text-sm">
                <span className="text-zinc-500">Описание</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveContent()} disabled={saving} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  <Save className="h-4 w-4" /> {saving ? "Сохранение…" : t("common.save")}
                </button>
                <button type="button" onClick={() => { setEditing(false); setName(item.name); setDescription(item.description ?? ""); setItemType(item.itemType); setBrand(item.brand ?? ""); setModel(item.model ?? ""); setQuantity(String(item.quantity)); setUnitPrice(String(item.unitPrice)); }} className="rounded-lg border border-black/10 px-4 py-2 text-sm text-zinc-600">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("items.name")} value={item.name} />
              <Field label="Тип ТМЦ" value={item.itemType} />
              <Field label="Бренд / модель" value={[item.brand, item.model].filter(Boolean).join(" / ") || "Не указано"} />
              <Field label={t("items.inventoryNumber")} value={`${item.inventoryNumber}${item.inventoryNumberKind === "temporary" ? " (требует присвоения)" : ""}`} />
              <Field label="Кабинет" value={`${item.room.buildingName}, ${item.room.designation}`} />
              <Field label="Этаж" value={String(item.room.floorNumber)} />
              <Field label={t("items.status")} value={statusLabel} />
              <Field label={t("items.responsible")} value={item.responsible?.name || t("common.notAssigned")} />
              <Field label="Количество" value={String(item.quantity)} />
              <Field label="Цена за единицу" value={`${item.unitPrice.toFixed(2)} ₸`} />
              <Field label="Версия записи" value={String(item.version)} />
              <Field label={t("items.updated")} value={new Date(item.updatedAt).toLocaleString()} />
              <div className="sm:col-span-2">
                <Field label="Описание" value={item.description || t("common.notSpecified")} />
              </div>
            </dl>
          )}
        </section>
      </div>

      {timeline.length ? (
        <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-800">История ответственности</h2>
          <ol className="mt-4 space-y-3">
            {timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-zinc-800">
                    {timelineTitle(entry)}
                  </p>
                  <time className="text-xs text-zinc-400" dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString()}
                  </time>
                </div>
                <p className="mt-1 text-zinc-500">
                  {entry.actorName ? `${entry.actorName} → ` : ""}
                  {entry.responsibleName ?? "Не назначен"}
                  {entry.detail ? ` · ${entry.detail}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function timelineTitle(entry: ResponsibilityTimelineEntryDto) {
  if (entry.kind === "responsibility") {
    return entry.status === "transfer"
      ? "Ответственность передана"
      : entry.status === "admin_override"
        ? "Ответственность изменена администратором"
        : "Ответственность принята";
  }
  const labels: Record<string, string> = {
    pending_current_owner: "Запрошена передача",
    confirmed: "Передача подтверждена",
    rejected: "Передача отклонена",
    cancelled: "Передача отменена",
    overridden: "Передача изменена администратором",
  };
  return labels[entry.status] ?? "Передача ответственности";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-zinc-800">{value}</dd>
    </div>
  );
}
