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

test("renders T1 as a localized, non-interactive construction block", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /data-testid="t1-construction"/);
  assert.match(source, /id="t1-building"/);
  assert.match(source, /t\("map\.t1Construction"\)/);
  assert.match(source, /pointer-events:none/);
  assert.doesNotMatch(source, /id: "t1-building",[\s\S]*?onClick/);
});

test("renders two basketball and two football decorative fields without interactions", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const DECORATIVE_FIELDS: DecorativeField\[\] = \[/);
  assert.equal((source.match(/id: "basketball-[12]"/g) ?? []).length, 2);
  assert.equal((source.match(/id: "football-[12]"/g) ?? []).length, 2);
  assert.match(source, /data-testid=\{`decorative-\$\{field\.id\}`\}/);
  for (const id of ["basketball-1", "basketball-2", "football-1", "football-2"]) {
    assert.match(source, new RegExp(`id: "${id}"`));
  }
  assert.match(source, /pointerEvents: "none"/);
  assert.match(source, /left: "72%"[\s\S]*?top: 74/);
  assert.match(source, /left: "84%"[\s\S]*?top: 74/);
  assert.match(source, /left: "72%"[\s\S]*?top: 178/);
  assert.match(source, /left: "84%"[\s\S]*?top: 178/);
  assert.ok(source.indexOf("DECORATIVE_FIELDS.map") < source.indexOf("BUILDINGS.map"));
  const fieldsBlock = source.slice(source.indexOf("const DECORATIVE_FIELDS"), source.indexOf("{BUILDINGS.map"));
  assert.doesNotMatch(fieldsBlock, /zIndex:\s*[1-9]/);
  assert.doesNotMatch(fieldsBlock, /onClick/);
});
