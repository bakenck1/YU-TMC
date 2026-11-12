"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import { normalizeApartmentAddress } from "@/lib/apartment-locations";
import ApartmentAddressFields, { EMPTY_APARTMENT } from "./ApartmentAddressFields";
import { CAMPUS_INVENTORY_BUILDING_PRESETS, findCampusBuildingPreset } from "@/lib/campus-directory";
import { translateCampusBuilding } from "@/lib/i18n";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";
import IconButton from "./IconButton";

export interface InventoryBuildingFormModalProps { building: BuildingDto | null; existingBuildingNames: string[]; onClose: () => void; onSave: (building: BuildingDto) => void; onApartmentSave?: (building: BuildingDto, room: RoomDto) => void }

export default function InventoryBuildingFormModal({ building, existingBuildingNames, onClose, onSave, onApartmentSave }: InventoryBuildingFormModalProps) {
  const { language, t } = useAppSettings();
  const [presetId, setPresetId] = useState(findCampusBuildingPreset(building?.name ?? "")?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apartment, setApartment] = useState(EMPTY_APARTMENT);
  const [floor, setFloor] = useState("1");
  const apartmentSelected = presetId === "apartments";
  let validApartment = false;
  try { normalizeApartmentAddress(apartment); validApartment = floor.trim() !== "" && Number.isInteger(Number(floor)) && Number(floor) >= -5 && Number(floor) <= 200; } catch {}
  const selectedPreset = CAMPUS_INVENTORY_BUILDING_PRESETS.find((preset) => preset.id === presetId);
  const existingNames = new Set(existingBuildingNames);
  const existingPresetIds = new Set(existingBuildingNames.map((name) => findCampusBuildingPreset(name)?.id).filter((id): id is string => Boolean(id)));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving || (!selectedPreset && !apartmentSelected)) return;
    if (apartmentSelected) {
      if (!validApartment) { setError(t("apartments.invalid")); return; }
      setSaving(true); setError(null);
      try {
        const response = await fetch("/api/inventory/apartments", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apartment, floorNumber: Number(floor) }) });
        const body = await response.json().catch(() => null) as { building?: BuildingDto; room?: RoomDto; error?: string } | null;
        if (!response.ok || !body?.building || !body.room) {
          setError(t(body?.error === "room_already_exists" ? "apartments.duplicate" : "inventory.saveFailed")); return;
        }
        if (onApartmentSave) onApartmentSave(body.building, body.room);
        else onSave(body.building);
      } catch { setError(t("inventory.saveFailed")); } finally { setSaving(false); }
      return;
    }
    if (!selectedPreset) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(building ? `/api/inventory/buildings/${encodeURIComponent(building.id)}` : "/api/inventory/buildings", { method: building ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: selectedPreset.name, address: selectedPreset.address, ...(building ? { version: building.version } : {}) }) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("building" in body)) { setError(t("inventory.saveFailed")); return; }
      onSave((body as { building: BuildingDto }).building);
    } catch { setError(t("inventory.saveFailed")); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="building-form-title">
      <form onSubmit={submit} className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="flex items-center justify-between"><h2 id="building-form-title" className="text-lg font-semibold text-zinc-900">{t(building ? "inventory.editBuilding" : "inventory.createBuilding")}</h2><IconButton label={t("common.close")} icon={X} onClick={onClose} disabled={saving} size="sm" /></div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-zinc-700">{t("building.select")}<select value={presetId} onChange={(event) => setPresetId(event.target.value)} required autoFocus className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10" disabled={Boolean(building)}><option value="">{t("building.selectFromList")}</option>{CAMPUS_INVENTORY_BUILDING_PRESETS.map((preset) => <option key={preset.id} value={preset.id} disabled={!building && (existingNames.has(preset.name) || existingPresetIds.has(preset.id))}>{t("building.presetSummary", { name: translateCampusBuilding(language, preset.name), address: preset.address, count: preset.floorCount })}</option>)}<option value="apartments">{t("apartments.title")}</option></select></label>
          {apartmentSelected ? <ApartmentAddressFields value={apartment} onChange={setApartment} floor={floor} onFloorChange={setFloor} disabled={saving} /> : null}{selectedPreset ? <dl className="rounded-2xl bg-emerald-50 p-4 text-sm text-zinc-700"><div className="flex justify-between gap-4"><dt className="text-zinc-500">{t("inventory.buildingName")}</dt><dd className="text-right font-semibold">{translateCampusBuilding(language, selectedPreset.name)}</dd></div><div className="mt-2 flex justify-between gap-4"><dt className="text-zinc-500">{t("inventory.buildingAddress")}</dt><dd className="text-right font-semibold">{selectedPreset.address}</dd></div><div className="mt-2 flex justify-between gap-4"><dt className="text-zinc-500">{t("building.floors")}</dt><dd className="font-semibold">{selectedPreset.floorCount}</dd></div></dl> : null}
        </div>
        {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-6 grid grid-cols-2 gap-3"><Button onClick={onClose} disabled={saving} fullWidth>{t("common.cancel")}</Button><Button type="submit" variant="primary" disabled={apartmentSelected ? !validApartment : !selectedPreset} loading={saving} fullWidth>{saving ? t("inventory.saving") : t("common.save")}</Button></div>
      </form>
    </div>
  );
}
