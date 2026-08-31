import type { RoomDto } from "@/lib/contracts/inventory-locations";

export interface InventoryRoomFloor {
  floorNumber: number;
  label: string | null;
  rooms: RoomDto[];
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
      rooms: floor.rooms.toSorted((left, right) =>
        left.designation.localeCompare(right.designation, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    }));
}
