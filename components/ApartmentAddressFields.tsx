"use client";

import type { ApartmentAddress } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "./AppSettingsProvider";
import TextField from "./TextField";

export const EMPTY_APARTMENT: ApartmentAddress = { microdistrict: "", house: "", entrance: "", number: "" };

export default function ApartmentAddressFields({ value, onChange, floor, onFloorChange, disabled = false }: {
  value: ApartmentAddress; onChange(value: ApartmentAddress): void;
  floor: string; onFloorChange(value: string): void; disabled?: boolean;
}) {
  const { t } = useAppSettings();
  return <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2 [&_input]:text-base sm:[&_input]:text-sm">
    {(["microdistrict", "house", "entrance", "number"] as const).map(key =>
      <TextField key={key} label={t(`apartments.${key}`)} value={value[key]}
        maxLength={key === "microdistrict" ? 16 : key === "entrance" ? 8 : 12}
        onChange={event => onChange({ ...value, [key]: event.target.value })} required />)}
    <TextField label={t("inventory.floor")} type="number" min={-5} max={200} step={1}
      value={floor} onChange={event => onFloorChange(event.target.value)} required />
  </fieldset>;
}
