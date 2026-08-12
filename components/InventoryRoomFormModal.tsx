"use client";

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import type { UserDto } from "@/lib/contracts/users";
import { findCampusBuildingPreset } from "@/lib/campus-directory";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";
import IconButton from "./IconButton";
import SelectField from "./SelectField";
import TextField from "./TextField";

export interface InventoryRoomFormModalProps { building: BuildingDto; room: RoomDto | null; onClose: () => void; onSave: (room: RoomDto) => void }

export default function InventoryRoomFormModal({ building, room, onClose, onSave }: InventoryRoomFormModalProps) {
  const { t } = useAppSettings();
  const [designation, setDesignation] = useState(room?.designation ?? "");
  const floorCount = findCampusBuildingPreset(building.name)?.floorCount ?? 1;
  const [floorNumber, setFloorNumber] = useState(String(room?.floorNumber ?? 1));
  const [responsibleId, setResponsibleId] = useState(room?.primaryResponsible?.id ?? "");
  const [employees, setEmployees] = useState<UserDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { let active = true; void fetch("/api/users", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((body: { users?: UserDto[] } | null) => { if (active) setEmployees((body?.users ?? []).filter((user) => user.role === "employee" && user.active)); }); return () => { active = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const floor = Number(floorNumber);
    if (saving || !designation.trim() || !responsibleId || !Number.isInteger(floor) || floor < 1 || floor > floorCount) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(room ? `/api/inventory/rooms/${encodeURIComponent(room.id)}` : `/api/inventory/buildings/${encodeURIComponent(building.id)}/rooms`, { method: room ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ designation: designation.trim(), floorNumber: floor, floorLabel: null, primaryResponsibleId: responsibleId, ...(room ? { version: room.version } : {}) }) });
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
          <div className="sm:col-span-2"><SelectField label={t("room.responsible")} fieldSize="lg" value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)} options={[{ value: "", label: t("common.notAssigned") }, ...employees.map((employee) => ({ value: employee.id, label: employee.fullName }))]} /></div>
          <SelectField label={t("inventory.floor")} fieldSize="lg" value={floorNumber} onChange={(event) => setFloorNumber(event.target.value)} required options={Array.from({ length: floorCount }, (_, index) => ({ value: index + 1, label: `${index + 1} ${t("inventory.floorShort")}` }))} />
        </div>
        {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-6 grid grid-cols-2 gap-3"><Button onClick={onClose} disabled={saving} fullWidth>{t("common.cancel")}</Button><Button type="submit" variant="primary" disabled={!designation.trim() || !responsibleId} loading={saving} fullWidth>{saving ? t("inventory.saving") : t("common.save")}</Button></div>
      </form>
    </div>
  );
}
