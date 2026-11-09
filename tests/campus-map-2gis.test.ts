import assert from "node:assert/strict";
import test from "node:test";
import {
CAMPUS_INVENTORY_BUILDING_PRESETS,
CAMPUS_MAP_BUILDING_PRESETS,
campusBuildingFloorNumbers,
findCampusBuildingPreset,
} from "../lib/campus-directory";
import { buildCampusMapData } from "../lib/campus-map-data";
import type { BuildingDto,RoomDto } from "../lib/contracts/inventory-locations";

const REQUIRED_MAP_OBJECTS = [
  ["center-1", "Центр обслуживания"],
  ["center-2", "Шерқала"],
  ["yessenov-stadium", "Yessenov Stadium"],
] as const;

test("adds the three 2GIS campus objects as interactive map buildings", () => {
  const map = buildCampusMapData([], [], []);

  for (const [id, name] of REQUIRED_MAP_OBJECTS) {
    assert.equal(findCampusBuildingPreset(name)?.id, id);
    assert.equal(map.buildings[id]?.name, name);
    assert.equal(map.buildings[id]?.floorCount, id === "yessenov-stadium" ? 2 : 1);
  }
  assert.equal(map.totals.locations, 10);
  assert.equal(CAMPUS_MAP_BUILDING_PRESETS.length, 10);
});

test("builds both stadium floor selectors even when no rooms are stored yet", () => {
  const stadium = buildCampusMapData([], [], []).buildings["yessenov-stadium"];

  assert.equal(stadium?.floorCount, 2);
  assert.deepEqual(stadium?.floors.map((floor) => floor.n), [1, 2]);
  assert.deepEqual(stadium?.floors.map((floor) => floor.roomCount), [0, 0]);
});

test("builds Main Campus floor selectors from zero through fifteen", () => {
  const mainCampus = buildCampusMapData([], [], []).buildings["main-campus"];

  assert.equal(mainCampus?.floorCount, 16);
  assert.deepEqual(
    mainCampus?.floors.map((floor) => floor.n),
    Array.from({ length: 16 }, (_, index) => index),
  );
});

test("keeps Marine Academy floors one through three and adds floor zero to the directory and map", () => {
  const preset = findCampusBuildingPreset("Корпус Морской академии")!;
  assert.equal(preset.address, "32-й микрорайон, Актау");
  assert.equal(preset.floorCount, 4);
  assert.deepEqual(campusBuildingFloorNumbers(preset), [0, 1, 2, 3]);
  const marine = buildCampusMapData([], [], []).buildings["marine-academy"];
  assert.equal(marine.floorCount, 4);
  assert.deepEqual(marine.floors.map((floor) => floor.n), [0, 1, 2, 3]);
  assert.deepEqual(marine.floors.map((floor) => floor.roomCount), [0, 0, 0, 0]);
});

test("places saved Marine Academy ground-floor rooms on floor zero without losing upper-floor rooms", () => {
  const building: BuildingDto = {
    id: "marine-building", name: "Корпус Морской академии", address: "32-й микрорайон",
    qrCode: "", roomCount: 4, status: "active", version: 1,
    createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z",
  };
  const rooms: RoomDto[] = [0, 1, 2, 3].map((floorNumber) => ({
    id: `marine-room-${floorNumber}`, buildingId: building.id, designation: `${floorNumber}01`,
    floorNumber, floorLabel: null, primaryResponsible: null, qrCode: "", status: "active", version: 1,
    createdAt: building.createdAt, updatedAt: building.updatedAt,
  }));
  const marine = buildCampusMapData([building], rooms, []).buildings["marine-academy"];
  assert.deepEqual(marine.floors.map((floor) => floor.roomCount), [1, 1, 1, 1]);
  assert.deepEqual(marine.floors.map((floor) => floor.rooms[0].code), ["001", "101", "201", "301"]);
});

test("keeps KGISE on the map as a named non-interactive landmark and removes it from operational buildings", () => {
  const kgise = findCampusBuildingPreset("Kazakh-German Institute of Sustainable Engineering");
  assert.equal(kgise?.inventoryVisible, false);
  assert.ok(CAMPUS_MAP_BUILDING_PRESETS.some(preset => preset.id === "kgise"));
  assert.ok(!CAMPUS_INVENTORY_BUILDING_PRESETS.some(preset => preset.id === "kgise"));
  assert.ok(buildCampusMapData([], [], []).buildings.kgise);
});
