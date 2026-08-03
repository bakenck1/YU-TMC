import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findCampusBuildingPreset } from "../lib/campus-directory";
import { translateCampusBuilding } from "../lib/i18n";

test("center presets use the new names while accepting legacy records", () => {
  assert.equal(findCampusBuildingPreset("Центр обслуживания")?.id, "center-1");
  assert.equal(findCampusBuildingPreset("Центр 1")?.id, "center-1");
  assert.equal(findCampusBuildingPreset("Шерқала")?.id, "center-2");
  assert.equal(findCampusBuildingPreset("Центр 2")?.id, "center-2");
});

test("center labels are localized", () => {
  assert.equal(translateCampusBuilding("ru", "Центр обслуживания"), "Центр обслуживания");
  assert.equal(translateCampusBuilding("kk", "Центр обслуживания"), "Қызмет көрсету орталығы");
  assert.equal(translateCampusBuilding("en", "Центр обслуживания"), "Service Center");
  assert.equal(translateCampusBuilding("ru", "Шерқала"), "Шерқала");
  assert.equal(translateCampusBuilding("kk", "Шерқала"), "Шерқала");
  assert.equal(translateCampusBuilding("en", "Шерқала"), "Sherqala");
});

test("service center keeps its position with a reduced map footprint", () => {
  const source = readFileSync(
    new URL("../components/CampusMap.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /id: "center-1",[\s\S]*?wrap: "position:absolute;left:39%;top:260px;width:96px;height:62px;"/,
  );
  assert.doesNotMatch(
    source,
    /id: "center-1",[\s\S]*?width:120px;height:78px/,
  );
});
