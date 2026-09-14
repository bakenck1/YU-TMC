import assert from "node:assert/strict";
import test from "node:test";

import {
  campusBuildingFloorNumbers,
  CAMPUS_BUILDING_PRESETS,
  CAMPUS_INVENTORY_BUILDING_PRESETS,
  CAMPUS_MAP_BUILDING_PRESETS,
  findCampusBuildingPreset,
} from "../lib/campus-directory";
import { buildCampusMapData, isCampusBuildingName } from "../lib/campus-map-data";
import { translateCampusBuilding } from "../lib/i18n";

const ADDITIONAL_BUILDINGS = [
  {
    id: "yessenov-college",
    name: "Yessenov college",
    legacyName: "11 мкр",
    address: "11-й микрорайон, 46, Актау",
    floors: [1, 2],
  },
  {
    id: "engineering-faculty",
    name: "Факультет инжиниринга",
    legacyName: "24 мкр",
    address: "24-й микрорайон, 12, Актау",
    floors: [1, 2, 3, 4],
  },
  {
    id: "zerde-house",
    name: "Дом Зерде",
    legacyName: "32 мкр дом зерде",
    address: "32А микрорайон, 1, Актау",
    floors: [1, 2, 3, 4, 5],
  },
] as const;

test("adds the three requested 2GIS objects with their addresses and every floor", () => {
  for (const expected of ADDITIONAL_BUILDINGS) {
    const preset = findCampusBuildingPreset(expected.name);

    assert.equal(preset?.id, expected.id);
    assert.equal(preset?.address, expected.address);
    assert.equal(preset?.floorCount, expected.floors.length);
    assert.deepEqual(campusBuildingFloorNumbers(preset!), expected.floors);
    assert.equal(findCampusBuildingPreset(expected.legacyName)?.id, expected.id);
    assert.equal(
      translateCampusBuilding("ru", expected.legacyName),
      translateCampusBuilding("ru", expected.name),
    );
    assert.ok(CAMPUS_BUILDING_PRESETS.includes(preset!));
    assert.ok(CAMPUS_INVENTORY_BUILDING_PRESETS.includes(preset!));
  }
});

test("keeps off-campus 2GIS objects out of the fixed main-campus map", () => {
  const map = buildCampusMapData([], [], []);

  for (const expected of ADDITIONAL_BUILDINGS) {
    const preset = findCampusBuildingPreset(expected.name);

    assert.equal(preset?.mapVisible, false);
    assert.ok(!CAMPUS_MAP_BUILDING_PRESETS.includes(preset!));
    assert.equal(map.buildings[expected.id], undefined);
    assert.equal(isCampusBuildingName(expected.name), false);
  }
});

test("localizes the requested building names without losing their identity", () => {
  assert.equal(translateCampusBuilding("ru", "Yessenov college"), "Колледж Есенова");
  assert.equal(translateCampusBuilding("kk", "Yessenov college"), "Есенов колледжі");
  assert.equal(translateCampusBuilding("en", "Yessenov college"), "Yessenov College");

  assert.equal(translateCampusBuilding("ru", "Факультет инжиниринга"), "Факультет инжиниринга");
  assert.equal(translateCampusBuilding("kk", "Факультет инжиниринга"), "Инжиниринг факультеті");
  assert.equal(translateCampusBuilding("en", "Факультет инжиниринга"), "Faculty of Engineering");

  assert.equal(translateCampusBuilding("ru", "Дом Зерде"), "Дом Зерде");
  assert.equal(translateCampusBuilding("kk", "Дом Зерде"), "Зерде үйі");
  assert.equal(translateCampusBuilding("en", "Дом Зерде"), "Zerde House");
});
