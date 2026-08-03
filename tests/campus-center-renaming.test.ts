import assert from "node:assert/strict";
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
