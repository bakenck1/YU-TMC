import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CAMPUS_BUILDING_PRESETS,
  CAMPUS_MAP_BUILDING_PRESETS,
  findCampusBuildingPreset,
} from "../lib/campus-directory";
import {
  buildCampusMapData,
  isCampusBuildingName,
} from "../lib/campus-map-data";
import type { InventoryItemDto } from "../lib/contracts/inventory-items";
import type {
  BuildingDto,
  RoomDto,
} from "../lib/contracts/inventory-locations";

test("adds both off-campus dormitories to the building catalog", () => {
  const dormitory1 = findCampusBuildingPreset("Общежитие 1");
  const dormitory2 = findCampusBuildingPreset("Общежитие 2");

  assert.equal(dormitory1?.address, "Микрорайон 3Б, 10, Актау");
  assert.equal(dormitory2?.address, "27 микрорайон, 7, Актау");
  assert.equal(dormitory1?.mapVisible, false);
  assert.equal(dormitory2?.mapVisible, false);
  assert.ok(CAMPUS_BUILDING_PRESETS.includes(dormitory1!));
  assert.ok(CAMPUS_BUILDING_PRESETS.includes(dormitory2!));
});

test("keeps the off-campus dormitories out of the campus map", () => {
  const map = buildCampusMapData([], [], []);

  assert.equal(map.buildings["off-campus-dormitory-1"], undefined);
  assert.equal(map.buildings["off-campus-dormitory-2"], undefined);
  assert.equal(map.totals.locations, CAMPUS_MAP_BUILDING_PRESETS.length);
  assert.equal(isCampusBuildingName("Общежитие 1"), false);
  assert.equal(isCampusBuildingName("Общежитие 2"), false);
  assert.equal(isCampusBuildingName("Неизвестный корпус"), false);
});

test("does not map rooms or inventory loaded from off-campus dormitories", () => {
  const buildings: BuildingDto[] = [
    building("off-campus-1", "Общежитие 1"),
    building("off-campus-2", "Общежитие 2"),
  ];
  const rooms: RoomDto[] = buildings.map((entry, index) => ({
    id: `off-campus-room-${index + 1}`,
    buildingId: entry.id,
    designation: `${index + 1}01`,
    floorNumber: 1,
    floorLabel: null,
    qrCode: `ROOM-${index + 1}`,
    status: "active",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  const items = rooms.map((room, index) =>
    item(`off-campus-item-${index + 1}`, room, buildings[index]!.name),
  );

  const map = buildCampusMapData(buildings, rooms, items);

  assert.equal(map.buildings["off-campus-dormitory-1"], undefined);
  assert.equal(map.buildings["off-campus-dormitory-2"], undefined);
  assert.deepEqual(map.itemsById, {});
  assert.equal(map.totals.units, 0);
  assert.equal(map.totals.attention, 0);
  assert.equal(map.totals.locations, CAMPUS_MAP_BUILDING_PRESETS.length);
});

test("does not define off-campus dormitory overlays in the campus renderer", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /id: "off-campus-dormitory-[12]"/);
});

function building(id: string, name: string): BuildingDto {
  return {
    id,
    name,
    address: "Вне кампуса",
    qrCode: `BUILDING-${id}`,
    roomCount: 1,
    status: "active",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function item(
  id: string,
  room: RoomDto,
  buildingName: string,
): InventoryItemDto {
  return {
    id,
    name: "ТМЦ вне кампуса",
    description: null,
    itemType: "Мебель",
    brand: null,
    model: null,
    quantity: 1,
    unitPrice: 0,
    inventoryNumberKind: "temporary",
    inventoryNumber: `INV-${id}`,
    room: {
      id: room.id,
      designation: room.designation,
      floorNumber: room.floorNumber,
      buildingId: room.buildingId,
      buildingName,
    },
    status: "active",
    qrCode: null,
    responsible: null,
    photoUrl: null,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  };
}
