import assert from "node:assert/strict";
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
