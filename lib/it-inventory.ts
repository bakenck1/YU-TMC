export const INVENTORY_SECTIONS = ["general", "it"] as const;
export type InventorySection = (typeof INVENTORY_SECTIONS)[number];

export const IT_EQUIPMENT_TYPES = ["wifi_access_point", "camera"] as const;
export type ItEquipmentType = (typeof IT_EQUIPMENT_TYPES)[number];

export interface ItNetworkAddressInput {
  deviceLabel?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
}

export interface ItNetworkAddress extends Required<ItNetworkAddressInput> {
  id: string;
}

export function isItEquipmentType(value: unknown): value is ItEquipmentType {
  return (
    typeof value === "string" &&
    IT_EQUIPMENT_TYPES.some((candidate) => candidate === value)
  );
}

export function hasItNetworkAddressValue(
  address: unknown,
): address is ItNetworkAddressInput {
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return false;
  }
  const candidate = address as ItNetworkAddressInput;
  return [candidate.deviceLabel, candidate.ipAddress, candidate.macAddress].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}
