import type { ApartmentAddress, RoomDto } from "@/lib/contracts/inventory-locations";

export const APARTMENTS_BUILDING_NAME = "Квартиры";

export function isApartmentsBuilding(name: string): boolean {
  return name.normalize("NFKC").trim().toLowerCase() === APARTMENTS_BUILDING_NAME.toLowerCase();
}

/** Address parts are identifiers, never numbers: preserve letter suffixes. */
export function normalizeApartmentAddress(value: unknown): ApartmentAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_apartment_address");
  const input = value as Record<string, unknown>;
  const result = {} as ApartmentAddress;
  const limits = { microdistrict: 16, house: 12, entrance: 8, number: 12 } as const;
  for (const key of Object.keys(limits) as (keyof ApartmentAddress)[]) {
    const raw = input[key];
    if (typeof raw !== "string") throw new Error("invalid_apartment_address");
    const normalized = raw.normalize("NFKC").trim().toUpperCase().replace(/^0+(?=\d)/u, "");
    if (normalized.length > limits[key] || !/^\d[\p{L}\d/-]*$/u.test(normalized)) throw new Error("invalid_apartment_address");
    result[key] = normalized;
  }
  return result;
}

export function apartmentDesignation(apartment: ApartmentAddress): string {
  return `мкр ${apartment.microdistrict}, дом ${apartment.house}, кв. ${apartment.number}`;
}

export function groupApartmentsByMicrodistrict(rooms: readonly RoomDto[]) {
  const grouped = new Map<string, RoomDto[]>();
  const ungrouped: RoomDto[] = [];
  for (const room of rooms) {
    if (!room.apartment) { ungrouped.push(room); continue; }
    const key = room.apartment.microdistrict;
    const members = grouped.get(key) ?? [];
    members.push(room);
    grouped.set(key, members);
  }
  const groups: { microdistrict: string; rooms: RoomDto[] }[] = [];
  for (const [microdistrict, members] of grouped) {
    if (members.length < 2) ungrouped.push(...members);
    else groups.push({ microdistrict, rooms: members });
  }
  const compare = (a: RoomDto, b: RoomDto) => a.designation.localeCompare(b.designation, "ru", { numeric: true }) || a.id.localeCompare(b.id);
  return {
    groups: groups.sort((a,b) => a.microdistrict.localeCompare(b.microdistrict, "ru", { numeric: true }))
      .map(group => ({ ...group, rooms: group.rooms.toSorted(compare) })),
    ungrouped: ungrouped.toSorted(compare),
  };
}
