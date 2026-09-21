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
] as const;

export type MainCampusWingCode = (typeof MAIN_CAMPUS_WINGS)[number]["code"];

export interface InventoryRoomWing {
  code: MainCampusWingCode;
  label: string;
  rooms: RoomDto[];
}

const MAIN_CAMPUS_WING_BY_PREFIX: Readonly<Record<string, MainCampusWingCode>> = {
  A: "A",
  B: "B",
  D: "D",
  E: "E",
  V: "B",
  А: "A",
  Б: "B",
  В: "B",
  Д: "D",
  Е: "E",
};

const MAIN_CAMPUS_WING_LETTERS = "ABDEVАБВДЕ";

export function isMainCampusWingFloor(floorNumber: number): boolean {
  return floorNumber >= 0 && floorNumber <= 4;
}

export function groupInventoryRoomsByMainCampusWing(
  rooms: readonly RoomDto[],
): { wings: InventoryRoomWing[]; unassignedRooms: RoomDto[] } {
  const roomsByWing = new Map<MainCampusWingCode, RoomDto[]>();
  const unassignedRooms: RoomDto[] = [];

  for (const room of rooms) {
    const wingCode = mainCampusWingFromDesignation(room.designation);
    if (!wingCode) {
      unassignedRooms.push(room);
      continue;
    }
    const wingRooms = roomsByWing.get(wingCode) ?? [];
    wingRooms.push(room);
    roomsByWing.set(wingCode, wingRooms);
  }

  return {
    wings: MAIN_CAMPUS_WINGS.map((wing) => ({
      ...wing,
      rooms: naturallySortRooms(roomsByWing.get(wing.code) ?? []),
    })),
    unassignedRooms: naturallySortRooms(unassignedRooms),
  };
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
 * order shown in the inventory UI (A, B, D, E), then the room number.
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
