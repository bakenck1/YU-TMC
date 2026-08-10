import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAMPUS_MAP_BUILDING_PRESETS,
  CAMPUS_INVENTORY_BUILDING_PRESETS,
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

test("keeps KGISE on the map as a named non-interactive landmark and removes it from operational buildings", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );
  const kgise = findCampusBuildingPreset(
    "Kazakh-German Institute of Sustainable Engineering",
  );
  const kgiseBlock = source.match(
    /id: "kgise",([\s\S]*?)(?=\n  \{\n    id:|\n\];)/,
  )?.[1] ?? "";

  assert.equal(kgise?.inventoryVisible, false);
  assert.ok(CAMPUS_MAP_BUILDING_PRESETS.some((preset) => preset.id === "kgise"));
  assert.ok(!CAMPUS_INVENTORY_BUILDING_PRESETS.some((preset) => preset.id === "kgise"));
  assert.match(kgiseBlock, /interactive: false/);
  assert.doesNotMatch(kgiseBlock, /statusKey:/);
  assert.match(source, /pointerEvents: isInteractive \? "auto" : "none"/);
  assert.match(source, /onClick=\{isInteractive \? \(\) => openBuilding\(b\.id\) : undefined\}/);

  const manager = readFileSync(
    new URL("../components/InventoryBuildingsManager.tsx", import.meta.url),
    "utf8",
  );
  assert.match(manager, /CAMPUS_INVENTORY_BUILDING_PRESETS\.map/);
  for (const path of [
    "../app/(protected)/inventory/page.tsx",
    "../app/inventory/rooms/qr-print/page.tsx",
    "../app/(protected)/items/page.tsx",
    "../app/(protected)/items/[id]/page.tsx",
    "../app/(protected)/inventory/inspections/page.tsx",
    "../app/api/inventory/excel/route.ts",
  ]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /isInventoryBuildingName/);
  }
  const itemDetailPage = readFileSync(
    new URL("../app/(protected)/items/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    itemDetailPage,
    /if \(!isInventoryBuildingName\(item\.room\.buildingName\)\) notFound\(\);/,
  );
});

test("renders one basketball and two football decorative fields in the marked column", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const DECORATIVE_FIELDS: DecorativeField\[\] = \[/);
  assert.equal((source.match(/id: "basketball-[12]"/g) ?? []).length, 1);
  assert.equal((source.match(/id: "football-[12]"/g) ?? []).length, 2);
  assert.match(source, /data-testid=\{`decorative-\$\{field\.id\}`\}/);
  for (const id of ["basketball-1", "football-1", "football-2"]) {
    assert.match(source, new RegExp(`id: "${id}"`));
  }
  assert.doesNotMatch(source, /id: "basketball-2"/);
  assert.equal((source.match(/width: 150, height: 88/g) ?? []).length, 3);
  assert.match(source, /id: "basketball-1"[\s\S]*?top: 255, width: 150, height: 88/);
  assert.match(source, /id: "football-2"[\s\S]*?top: 349, width: 150, height: 88/);
  assert.match(source, /id: "football-1"[\s\S]*?top: 443, width: 150, height: 88/);
  assert.match(source, /pointerEvents: "none"/);
  assert.match(source, /left: "67%"[\s\S]*?top: 255/);
  assert.match(source, /left: "67%"[\s\S]*?top: 443/);
  assert.ok(source.indexOf("DECORATIVE_FIELDS.map") < source.indexOf("BUILDINGS.map"));
  const fieldsBlock = source.slice(source.indexOf("const DECORATIVE_FIELDS"), source.indexOf("{BUILDINGS.map"));
  assert.doesNotMatch(fieldsBlock, /zIndex:\s*[1-9]/);
  assert.doesNotMatch(fieldsBlock, /onClick/);
});

test("uses realistic court markings and turf details for decorative fields", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  // Basketball: key areas, center circle, hoops and three-point arcs.
  assert.match(source, /field\.kind === "basketball"/);
  assert.match(source, /border-radius:0 50% 50% 0/);
  assert.match(source, /background:#e8c66d/);
  // Football: striped turf, penalty boxes, six-yard boxes and goals.
  assert.match(source, /repeating-linear-gradient\(90deg/);
  assert.match(source, /top:24%;width:34px;height:52%/);
  assert.match(source, /top:39%;width:8px;height:22%/);
  assert.match(source, /repeating-linear-gradient\(0deg,#eef5e5/);
});
