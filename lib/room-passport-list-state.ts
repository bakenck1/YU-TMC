import { PASSPORT_STATUSES, type PassportStatus, type RoomPassportDto } from "@/lib/contracts/room-passports";

export interface RoomPassportFilters {
  building: string;
  floor: string;
  room: string;
  status: PassportStatus | "";
}
export const EMPTY_PASSPORT_FILTERS: RoomPassportFilters = { building: "", floor: "", room: "", status: "" };
export const PASSPORT_LIST_PATH = "/room-passports";
export type PassportSearchParams = Record<string, string | string[] | undefined>;

export function parsePassportFilters(params: PassportSearchParams | { get(name: string): string | null }): RoomPassportFilters {
  function read(name: string) {
    const value = "get" in params && typeof params.get === "function" ? params.get(name) : (params as PassportSearchParams)[name];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first.length <= 100 ? first : "";
  }
  const floor = read("floor");
  const status = read("status");
  return {
    building: read("building"), room: read("room"),
    floor: /^-?\d+$/.test(floor) && Number.isSafeInteger(Number(floor)) ? String(Number(floor)) : "",
    status: PASSPORT_STATUSES.includes(status as PassportStatus) ? status as PassportStatus : "",
  };
}

export function normalizePassportFilters(filters: RoomPassportFilters, passports: RoomPassportDto[]): RoomPassportFilters {
  const building = passports.some(row => row.buildingId === filters.building) ? filters.building : "";
  const location = passports.filter(row => !building || row.buildingId === building);
  const floor = (!filters.building || building) && location.some(row => String(row.floorNumber) === filters.floor) ? filters.floor : "";
  const room = (!filters.building || building) && (!filters.floor || floor) && location.some(row =>
    row.roomId === filters.room && (!floor || String(row.floorNumber) === floor)
  ) ? filters.room : "";
  return { building, floor, room, status: filters.status };
}

export function passportListHref(filters: RoomPassportFilters) {
  const params = new URLSearchParams();
  for (const key of ["building", "floor", "room", "status"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  const query = params.toString();
  return query ? `${PASSPORT_LIST_PATH}?${query}` : PASSPORT_LIST_PATH;
}

export function passportDetailsHref(roomId: string, listHref: string) {
  const path = `${PASSPORT_LIST_PATH}/${encodeURIComponent(roomId)}`;
  return listHref === PASSPORT_LIST_PATH ? path : `${path}?${new URLSearchParams({ returnTo: listHref })}`;
}

/** Only a passport list with known filters can be a return destination. */
export function passportReturnHref(value: unknown) {
  if (typeof value !== "string" || value.length > 2000 || !value.startsWith("/") || value.startsWith("//")) return PASSPORT_LIST_PATH;
  try {
    const base = "https://passport.local";
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname !== PASSPORT_LIST_PATH) return PASSPORT_LIST_PATH;
    return passportListHref(parsePassportFilters(url.searchParams));
  } catch { return PASSPORT_LIST_PATH; }
}
