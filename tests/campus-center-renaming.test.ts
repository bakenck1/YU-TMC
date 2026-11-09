import assert from "node:assert/strict";
import test from "node:test";
import { findCampusBuildingPreset } from "../lib/campus-directory";

test("center presets use the new names while accepting legacy records", () => {
  assert.equal(findCampusBuildingPreset("Центр обслуживания")?.id, "center-1");
  assert.equal(findCampusBuildingPreset("Центр 1")?.id, "center-1");
  assert.equal(findCampusBuildingPreset("Шерқала")?.id, "center-2");
  assert.equal(findCampusBuildingPreset("Центр 2")?.id, "center-2");
});
