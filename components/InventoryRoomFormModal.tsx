"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { campusBuildingFloorNumbers, findCampusBuildingPreset } from "@/lib/campus-directory";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";
import IconButton from "./IconButton";
import SelectField from "./SelectField";
import TextField from "./TextField";
import TmcUserPicker from "./TmcUserPicker";

export interface InventoryRoomFormModalProps { building: BuildingDto; room: RoomDto | null; onClose: () => void; onSave: (room: RoomDto) => void }

export default function InventoryRoomFormModal({ building, room, onClose, onSave }: InventoryRoomFormModalProps) {
  const { t } = useAppSettings();
  const [designation, setDesignation] = useState(room?.designation ?? "");
  const preset = findCampusBuildingPreset(building.name);
  const floorNumbers = preset ? campusBuildingFloorNumbers(preset) : [1];
  const [floorNumber, setFloorNumber] = useState(String(room?.floorNumber ?? 1));
  const [responsible, setResponsible] = useState<{ id: string; fullName: string } | null>(
    room?.primaryResponsible
      ? { id: room.primaryResponsible.id, fullName: room.primaryResponsible.name }
      : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedFloor = Number(floorNumber);
  const canSubmit =
    Boolean(designation.trim()) &&
    Number.isInteger(selectedFloor) &&
    floorNumbers.includes(selectedFloor);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canSubmit) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(room ? `/api/inventory/rooms/${encodeURIComponent(room.id)}` : `/api/inventory/buildings/${encodeURIComponent(building.id)}/rooms`, { method: room ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ designation: designation.trim(), floorNumber: selectedFloor, floorLabel: null, primaryResponsibleId: responsible?.id ?? null, ...(room ? { version: room.version } : {}) }) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("room" in body)) { setError(t("inventory.saveFailed")); return; }
      onSave((body as { room: RoomDto }).room);
    } catch { setError(t("inventory.saveFailed")); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="room-form-title">
      <form onSubmit={submit} className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between"><h2 id="room-form-title" className="text-lg font-semibold text-zinc-900">{room ? t("inventory.editRoom") : t("inventory.createRoom")}</h2><IconButton label={t("common.close")} icon={X} onClick={onClose} disabled={saving} size="sm" /></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <TextField label={t("inventory.roomDesignation")} value={designation} onChange={(event) => setDesignation(event.target.value)} maxLength={80} required />
          <div className="sm:col-span-2"><TmcUserPicker value={responsible} onChange={(user) => setResponsible(user)} employeeOnly label={t("room.responsible")} /></div>
          <SelectField label={t("inventory.floor")} fieldSize="lg" value={floorNumber} onChange={(event) => setFloorNumber(event.target.value)} required options={floorNumbers.map((value) => ({ value, label: `${value} ${t("inventory.floorShort")}` }))} />
        </div>
        {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-6 grid grid-cols-2 gap-3"><Button onClick={onClose} disabled={saving} fullWidth>{t("common.cancel")}</Button><Button type="submit" variant="primary" disabled={!canSubmit} loading={saving} fullWidth>{saving ? t("inventory.saving") : t("common.save")}</Button></div>
      </form>
    </div>
  );
}
