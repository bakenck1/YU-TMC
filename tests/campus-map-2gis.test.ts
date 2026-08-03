import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAMPUS_MAP_BUILDING_PRESETS,
  findCampusBuildingPreset,
} from "../lib/campus-directory";
import { buildCampusMapData } from "../lib/campus-map-data";

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

test("renders the stadium and centers, removes the court, and shifts KGI west", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  for (const [id] of REQUIRED_MAP_OBJECTS) {
    assert.match(source, new RegExp(`id: "${id}"`));
  }
  assert.doesNotMatch(source, /stadium track \(decor\)/);
  assert.doesNotMatch(source, /left:69\.53%;top:250px/);
  assert.doesNotMatch(source, /left:70\.16%;top:(?:290|390)px/);
  assert.match(
    source,
    /id: "kgise",[\s\S]*?left:3\.5%;top:555px/,
  );
});
