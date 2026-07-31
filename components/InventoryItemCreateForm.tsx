"use client";

import { useState } from "react";
import { Plus, ScanLine, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemCodeScanner from "@/components/InventoryItemCodeScanner";

export default function InventoryItemCreateForm({
  rooms,
  initialRoomId,
  openInitially = false,
  hideTrigger = false,
  onCreated,
  onDismiss,
}: {
  rooms: RoomDto[];
  initialRoomId?: string;
  openInitially?: boolean;
  hideTrigger?: boolean;
  onCreated?: () => void;
  onDismiss?: () => void;
}) {
  const router = useRouter();
  const { t } = useAppSettings();
  const [open, setOpen] = useState(openInitially);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState("ТМЦ");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [roomId, setRoomId] = useState(initialRoomId ?? rooms[0]?.id ?? "");
  const [inventoryNumber, setInventoryNumber] = useState("");
  const [codeScannerOpen, setCodeScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
          itemType,
          brand: brand || null,
          model: model || null,
          quantity: Number(quantity),
          unitPrice: unitPrice === "" ? 0 : Number(unitPrice),
          roomId,
          inventoryNumber: inventoryNumber || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "create_failed");
      setOpen(false);
      setName("");
      setDescription("");
      setItemType("ТМЦ");
      setBrand("");
      setModel("");
      setQuantity("1");
      setUnitPrice("");
      setInventoryNumber("");
      onCreated?.();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "create_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {!hideTrigger ? (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600">
        <Plus className="h-4 w-4" /> Добавить предмет
      </button>
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Добавить предмет">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-800">Новый предмет</h2>
              <button type="button" onClick={() => { setOpen(false); onDismiss?.(); }} aria-label={t("common.close")} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-5 w-5" /></button>
            </div>
            {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <div className="mt-5 space-y-4">
              <button type="button" onClick={() => setCodeScannerOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"><ScanLine className="h-4 w-4" />Сканировать код предмета</button>
              <label className="block text-sm"><span className="text-zinc-500">{t("items.name")}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm"><span className="text-zinc-500">Тип ТМЦ</span><input value={itemType} onChange={(event) => setItemType(event.target.value)} placeholder="Например, моноблок" className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">Бренд</span><input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Например, HP" className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">Модель</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Например, ProOne 440" className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm"><span className="text-zinc-500">Количество</span><input type="number" min="1" max="1000000" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
                <label className="block text-sm sm:col-span-2"><span className="text-zinc-500">Цена за единицу, ₸</span><input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="0" className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
              </div>
              <label className="block text-sm"><span className="text-zinc-500">Описание</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
              <label className="block text-sm"><span className="text-zinc-500">Кабинет</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 outline-none focus:border-emerald-500">{rooms.map((room) => <option key={room.id} value={room.id}>{room.designation} · этаж {room.floorNumber}</option>)}</select></label>
              <label className="block text-sm"><span className="text-zinc-500">Официальный инвентарный номер <span className="text-zinc-400">(необязательно)</span></span><input value={inventoryNumber} onChange={(event) => setInventoryNumber(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" /></label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => { setOpen(false); onDismiss?.(); }} className="rounded-lg border border-black/10 px-4 py-2 text-sm text-zinc-600">{t("common.cancel")}</button>
              <button type="button" onClick={() => void submit()} disabled={saving || !name.trim() || !roomId} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Создание…" : "Создать"}</button>
            </div>
            {codeScannerOpen ? (
              <InventoryItemCodeScanner
                onClose={() => setCodeScannerOpen(false)}
                onCodeSelected={(value) => {
                  setInventoryNumber(value);
                  setCodeScannerOpen(false);
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
