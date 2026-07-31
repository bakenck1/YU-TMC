import type { InventoryItemDto } from "@/lib/contracts/inventory-items";
import type { BuildingDto, RoomDto } from "@/lib/contracts/inventory-locations";
import {
  CAMPUS_MAP_BUILDING_PRESETS,
  findCampusBuildingPreset,
} from "@/lib/campus-directory";
import type {
  CampusBuilding,
  CampusItem,
  CampusStatus,
} from "@/lib/campus";

export interface CampusMapData {
  buildings: Record<string, CampusBuilding>;
  itemsById: Record<string, CampusItem>;
  totals: {
    units: number;
    attention: number;
    locations: number;
  };
}

/**
 * Builds the home-map view from the inventory records. The approved
 * campus buildings are always shown, including floors that do not yet have
 * rooms. This keeps the map's floor plan correct before the inventory is
 * populated and lets new rooms/items appear on the next page refresh.
 */
export function buildCampusMapData(
  buildings: readonly BuildingDto[],
  rooms: readonly RoomDto[],
  items: readonly InventoryItemDto[],
): CampusMapData {
  const activeBuildings = new Map(
    buildings
      .filter((building) => building.status === "active")
      .flatMap((building) => {
        const preset = findCampusBuildingPreset(building.name);
        return preset ? [[preset.id, building] as const] : [];
      }),
  );
  const roomsByBuildingId = groupBy(
    rooms.filter((room) => room.status === "active"),
    (room) => room.buildingId,
  );
  const itemsByRoomId = groupBy(items, (item) => item.room.id);
  const itemsById: Record<string, CampusItem> = {};
  const mapBuildings: Record<string, CampusBuilding> = {};

  for (const preset of CAMPUS_MAP_BUILDING_PRESETS) {
    const storedBuilding = activeBuildings.get(preset.id);
    const buildingRooms = storedBuilding
      ? roomsByBuildingId.get(storedBuilding.id) ?? []
      : [];
    const roomItems = new Map(
      buildingRooms.map((room) => [room.id, itemsByRoomId.get(room.id) ?? []]),
    );
    const all: CampusItem[] = [];

    const floors = Array.from({ length: preset.floorCount }, (_, index) => {
      const floorNumber = index + 1;
      const floorRooms = buildingRooms
        .filter((room) => room.floorNumber === floorNumber)
        .sort((left, right) => left.designation.localeCompare(right.designation, "ru"));
      const mappedRooms = floorRooms.map((room) => {
        const mappedItems = (roomItems.get(room.id) ?? []).map((item) => {
          const mapped = toCampusItem(item, preset.id);
          all.push(mapped);
          itemsById[mapped.id] = mapped;
          return mapped;
        });
        return {
          code: room.designation,
          name: `Кабинет ${room.designation}`,
          type: "room",
          items: mappedItems,
        };
      });
      const floorItems = mappedRooms.flatMap((room) => room.items);
      return {
        n: floorNumber,
        rooms: mappedRooms,
        units: floorItems.length,
        attn: floorItems.filter((item) => item.status !== "ok").length,
        roomCount: mappedRooms.length,
      };
    });

    mapBuildings[preset.id] = {
      id: preset.id,
      name: preset.name,
      sub: storedBuilding?.address ?? preset.address,
      floorCount: preset.floorCount,
      cats: [],
      floors,
      total: all.length,
      attn: all.filter((item) => item.status !== "ok").length,
      all,
    };
  }

  return {
    buildings: mapBuildings,
    itemsById,
    totals: {
      units: Object.values(mapBuildings).reduce(
        (total, building) => total + building.total,
        0,
      ),
      attention: Object.values(mapBuildings).reduce(
        (total, building) => total + building.attn,
        0,
      ),
      locations: CAMPUS_MAP_BUILDING_PRESETS.length,
    },
  };
}

export function isCampusBuildingName(name: string): boolean {
  const preset = findCampusBuildingPreset(name);
  return preset !== undefined && preset.mapVisible !== false;
}

function toCampusItem(item: InventoryItemDto, buildingId: string): CampusItem {
  return {
    id: item.id,
    name: item.name,
    category: "ТМЦ",
    invNo: item.inventoryNumber,
    status: campusStatus(item.status),
    lastInv: formatDate(item.updatedAt),
    responsible: item.responsible?.name ?? "Не назначен",
    history: [],
    room: `Кабинет ${item.room.designation}`,
    code: item.room.designation,
    floorN: item.room.floorNumber,
    buildingId,
  };
}

function campusStatus(status: InventoryItemDto["status"]): CampusStatus {
  switch (status) {
    case "maintenance":
      return "service";
    case "decommissioned":
      return "writeoff";
    default:
      return "ok";
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function groupBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey);
    if (group) group.push(value);
    else groups.set(groupKey, [value]);
  }
  return groups;
}
