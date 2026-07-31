import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPUS_BUILDING_PRESETS,
  findCampusBuildingPreset,
} from "../lib/campus-directory";
import { buildCampusMapData } from "../lib/campus-map-data";
import type {
  BuildingDto,
  RoomDto,
} from "../lib/contracts/inventory-locations";

test("uses the new dormitory names while recognizing stored legacy names", () => {
  const dormitory3 = CAMPUS_BUILDING_PRESETS.find(
    (preset) => preset.id === "dormitory-1",
  );
  const dormitory4 = CAMPUS_BUILDING_PRESETS.find(
    (preset) => preset.id === "dormitory-2",
  );

  assert.equal(dormitory3?.name, "Общежитие 3");
  assert.equal(dormitory4?.name, "Общежитие 4");
  assert.equal(findCampusBuildingPreset("Общежитие-1")?.id, "dormitory-1");
  assert.equal(findCampusBuildingPreset("Общежитие-2")?.id, "dormitory-2");
});

test("maps legacy database buildings to the renamed campus footprints", () => {
  const building: BuildingDto = {
    id: "stored-dormitory",
    name: "Общежитие-1",
    address: "32-й микрорайон",
    qrCode: "QR",
    roomCount: 1,
    status: "active",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const room: RoomDto = {
    id: "room-1",
    buildingId: building.id,
    designation: "101",
    floorNumber: 1,
    floorLabel: null,
    qrCode: "ROOM-QR",
    status: "active",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const map = buildCampusMapData([building], [room], []);

  assert.equal(map.buildings["dormitory-1"]?.name, "Общежитие 3");
  assert.equal(map.buildings["dormitory-1"]?.floors[0]?.roomCount, 1);
});
