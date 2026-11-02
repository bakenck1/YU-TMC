import type { RoomDto } from "@/lib/contracts/inventory-locations";

export interface InventoryRoomFloor {
  floorNumber: number;
  label: string | null;
  rooms: RoomDto[];
}

export const MAIN_CAMPUS_WINGS = [
  { code: "A", label: "A" },
  { code: "B", label: "B" },
  { code: "D", label: "D" },
  { code: "E", label: "E" },
  { code: "K", label: "К" },
] as const;

export type MainCampusWingCode = (typeof MAIN_CAMPUS_WINGS)[number]["code"];

export interface InventoryRoomWing {
  code: string;
  label: string;
  rooms: RoomDto[];
}

const MAIN_CAMPUS_WING_BY_PREFIX: Readonly<Record<string, MainCampusWingCode>> = {
  A: "A",
  B: "B",
  D: "D",
  E: "E",
  K: "K",
  V: "B",
  А: "A",
  Б: "B",
  В: "B",
  Д: "D",
  Е: "E",
  К: "K",
};

const MAIN_CAMPUS_WING_LETTERS = "ABDEVKАБВДЕК";

export function isMainCampusWingFloor(floorNumber: number): boolean {
  return floorNumber >= 0 && floorNumber <= 4;
}

export function groupInventoryRoomsByMainCampusWing(
  rooms: readonly RoomDto[],
  floorNumber: number,
): { wings: InventoryRoomWing[]; unassignedRooms: RoomDto[] } {
  const floorWings = MAIN_CAMPUS_WINGS.filter(
    (wing) => wing.code !== "K" || floorNumber === 2,
  );
  const roomsByWing = new Map<MainCampusWingCode, RoomDto[]>();
  const unassignedRooms: RoomDto[] = [];

  for (const room of rooms) {
    const wingCode = mainCampusWingFromDesignation(room.designation);
    if (!wingCode || !floorWings.some((wing) => wing.code === wingCode)) {
      unassignedRooms.push(room);
      continue;
    }
    const wingRooms = roomsByWing.get(wingCode) ?? [];
    wingRooms.push(room);
    roomsByWing.set(wingCode, wingRooms);
  }

  return {
    wings: floorWings.map((wing) => ({
      ...wing,
      rooms: naturallySortRooms(roomsByWing.get(wing.code) ?? []),
    })),
    unassignedRooms: naturallySortRooms(unassignedRooms),
  };
}

/** Engineering wings are discovered from saved rooms, without a fixed list. */
export function engineeringFacultyWingFromDesignation(
  designation: string,
): string | null {
  const normalized = designation.normalize("NFKC").trim().toLocaleUpperCase();
  return normalized.match(/^(\p{L})\s*[-–—./]?\s*\d/u)?.[1]
    ?? normalized.match(/^\d[\d\s./-]*[-–—]?\s*(\p{L})$/u)?.[1]
    ?? normalized.match(/(?:^|\s|[-–—./])(\p{L})$/u)?.[1]
    ?? normalized.match(/^(\p{L})\s+(?:КОРПУС|КОРПУСЫ|BLOCK)$/u)?.[1]
    ?? null;
}

/** Group a floor by letter only when at least two rooms share that letter. */
export function groupInventoryRoomsByEngineeringFacultyWing(
  rooms: readonly RoomDto[],
): { wings: InventoryRoomWing[]; unassignedRooms: RoomDto[] } {
  const roomsByWing = new Map<string, RoomDto[]>();
  const unassignedRooms: RoomDto[] = [];

  for (const room of rooms) {
    const code = engineeringFacultyWingFromDesignation(room.designation);
    if (!code) {
      unassignedRooms.push(room);
      continue;
    }
    const wingRooms = roomsByWing.get(code) ?? [];
    wingRooms.push(room);
    roomsByWing.set(code, wingRooms);
  }

  const wings: InventoryRoomWing[] = [];
  for (const [code, wingRooms] of roomsByWing) {
    // A single lettered room stays directly on its floor until it has a peer.
    if (wingRooms.length < 2) {
      unassignedRooms.push(...wingRooms);
    } else {
      wings.push({ code, label: code, rooms: naturallySortRooms(wingRooms) });
    }
  }

  return {
    wings: wings.sort((left, right) => left.code.localeCompare(right.code, "ru", { numeric: true })),
    unassignedRooms: naturallySortRooms(unassignedRooms),
  };
}

const ROOM_SEARCH_LOOKALIKE_LETTERS: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o",
  р: "p", с: "c", т: "t", у: "y", х: "x", і: "i",
};

/** Compare visually matching Cyrillic/Latin letters without changing room names. */
export function normalizeInventoryRoomSearch(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase()
    .replace(/[авекмнорстухі]/g, (letter) => ROOM_SEARCH_LOOKALIKE_LETTERS[letter] ?? letter)
    .replace(/\s+/g, " ");
}

export function mainCampusWingFromDesignation(
  designation: string,
): MainCampusWingCode | null {
  const normalized = designation.trim().normalize("NFKC").toLocaleUpperCase();
  const letterBeforeNumber = normalized.match(
    new RegExp(`^([${MAIN_CAMPUS_WING_LETTERS}])\\s*[-–—./]?\\s*\\d`, "u"),
  )?.[1];
  const letterAfterNumber = normalized.match(
    new RegExp(`^\\d[\\d\\s]*[-–—./]?\\s*([${MAIN_CAMPUS_WING_LETTERS}])$`, "u"),
  )?.[1];
  const standaloneLetterAtEnd = normalized.match(
    new RegExp(`(?:^|\\s|[-–—./])([${MAIN_CAMPUS_WING_LETTERS}])$`, "u"),
  )?.[1];
  const wingLetter = letterBeforeNumber ?? letterAfterNumber ?? standaloneLetterAtEnd;

  return wingLetter ? MAIN_CAMPUS_WING_BY_PREFIX[wingLetter] ?? null : null;
}

export function groupInventoryRoomsByFloor(
  rooms: readonly RoomDto[],
): InventoryRoomFloor[] {
  const floors = new Map<number, InventoryRoomFloor>();

  for (const room of rooms) {
    const floor = floors.get(room.floorNumber);
    if (floor) {
      floor.rooms.push(room);
      if (!floor.label && room.floorLabel) floor.label = room.floorLabel;
      continue;
    }
    floors.set(room.floorNumber, {
      floorNumber: room.floorNumber,
      label: room.floorLabel,
      rooms: [room],
    });
  }

  return [...floors.values()]
    .sort((left, right) => left.floorNumber - right.floorNumber)
    .map((floor) => ({
      ...floor,
      rooms: naturallySortRooms(floor.rooms),
    }));
}

/**
 * Keeps room pickers predictable: floors first, then the Main Campus wing
 * order shown in the inventory UI (A, B, D, E, K), then the room number.
 * Rooms without a recognized wing stay after the known wings on their floor.
 */
export function sortInventoryRoomsForSelection<
  T extends Pick<RoomDto, "designation" | "floorNumber">,
>(rooms: readonly T[]): T[] {
  return rooms.toSorted((left, right) => {
    const floorOrder = left.floorNumber - right.floorNumber;
    if (floorOrder !== 0) return floorOrder;

    const leftWing = mainCampusWingFromDesignation(left.designation);
    const rightWing = mainCampusWingFromDesignation(right.designation);
    const leftWingOrder = leftWing ? MAIN_CAMPUS_WINGS.findIndex((wing) => wing.code === leftWing) : MAIN_CAMPUS_WINGS.length;
    const rightWingOrder = rightWing ? MAIN_CAMPUS_WINGS.findIndex((wing) => wing.code === rightWing) : MAIN_CAMPUS_WINGS.length;
    const wingOrder = leftWingOrder - rightWingOrder;
    if (wingOrder !== 0) return wingOrder;

    return naturalRoomDesignationCompare(left, right);
  });
}

function naturallySortRooms(rooms: readonly RoomDto[]): RoomDto[] {
  return rooms.toSorted(naturalRoomDesignationCompare);
}

function naturalRoomDesignationCompare(
  left: Pick<RoomDto, "designation">,
  right: Pick<RoomDto, "designation">,
): number {
  return left.designation.localeCompare(right.designation, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
